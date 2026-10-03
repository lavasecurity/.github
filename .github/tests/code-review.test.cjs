const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const test = require('node:test');

const workflow = readFileSync(join(__dirname, '../workflows/code-review.yml'), 'utf8');
function stepBody(name, key) {
  const step = workflow.split(`      - name: ${name}\n`)[1].split('\n      - name: ')[0];
  const body = step.split(`        ${key}: |\n`)[1] || step.split(`          ${key}: |\n`)[1];
  return body.split('\n').filter(line => line.startsWith('          ')).map(line => line.replace(/^ {10,12}/, '')).join('\n');
}

test('review budgets stay bounded and allow full source syncs and on-demand reviews', () => {
  const raw = workflow.match(/^    timeout-minutes: (.+)$/m)[1].split('  #')[0].trim();
  const evaluate = /^\d+$/.test(raw) ? () => Number(raw)
    : new Function('github', `return (${raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`);
  for (const [event, files, minutes] of [
    ['pull_request', undefined, 30], ['pull_request', 1, 30],
    ['pull_request', 499, 30], ['pull_request', 500, 360],
    ['pull_request', 1470, 360], ['issue_comment', undefined, 360],
  ]) {
    assert.equal(evaluate({event_name:event,event:{pull_request:{changed_files:files}}}), minutes, `${event}: ${files}`);
  }
});

test('large review worker counts reach the actual CLI for PRs and on-demand runs', () => {
  const raw = workflow.match(/^          OCR_REVIEW_CONCURRENCY: (.+)$/m)[1].trim();
  const evaluate = new Function('inputs', 'github', 'steps',
    `return (${raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replaceAll('steps.pr-context', "steps['pr-context']")});`);
  const dir = mkdtempSync(join(tmpdir(), 'ocr-worker-count-'));
  try {
    writeFileSync(join(dir, 'ocr'), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.OCR_CAPTURE,JSON.stringify(process.argv.slice(2)));process.stdout.write(JSON.stringify({status:"complete",comments:[]}));\n', {mode:0o755});
    for (const [event, files, resolvedFiles, endpoint, expected] of [
      ['pull_request', undefined, undefined, 'https://opencode.ai/zen/go/v1', 8],
      ['pull_request', 499, undefined, 'https://opencode.ai/zen/go/v1', 8],
      ['pull_request', 500, undefined, 'https://opencode.ai/zen/go/v1', 16],
      ['pull_request', 1470, undefined, 'https://opencode.ai/zen/go/v1/', 16],
      ['issue_comment', undefined, undefined, 'https://opencode.ai/zen/go/v1', 8],
      ['issue_comment', undefined, '499', 'https://opencode.ai/zen/go/v1', 8],
      ['issue_comment', undefined, '1470', 'https://opencode.ai/zen/go/v1', 16],
      ['pull_request', 1470, undefined, 'https://example.com/v1', 8],
      ['issue_comment', undefined, '1470', 'https://example.com/v1/messages', 8],
      ['pull_request', 1470, undefined, 'https://opencode.ai/zen/go/v1/messages', 8],
    ]) {
      const workers = evaluate({llm_url:endpoint}, {event:{pull_request:{changed_files:files}}},
        {'pr-context':{outputs:{changed_files:resolvedFiles}}});
      assert.equal(workers, expected);
      const capture = join(dir, 'args.json');
      const body = stepBody('Run OpenCodeReview', 'run')
        .replaceAll('/tmp/ocr-result.json', join(dir, 'result.json'))
        .replaceAll('/tmp/ocr-stderr.log', join(dir, 'stderr.log'));
      const result = spawnSync('bash', ['-e', '-c', body], {env:{...process.env,PATH:`${dir}:${process.env.PATH}`,
        OCR_CAPTURE:capture,EVENT_NAME:event,PR_ACTION:'opened',PR_BASE_REF:'main',PR_HEAD_SHA:'synthetic',
        CTX_BASE_REF:'main',CTX_HEAD_SHA:'synthetic',OCR_REVIEW_CONCURRENCY:String(workers)}});
      assert.equal(result.status,0,result.stderr.toString());
      const args = JSON.parse(readFileSync(capture,'utf8'));
      assert.ok(args.includes('--concurrency'));
      assert.equal(args[args.indexOf('--concurrency')+1],String(expected));
    }
  } finally {rmSync(dir,{recursive:true});}
});

test('only explicitly public repositories default to the free model', () => {
  const raw = workflow.match(/^          OCR_LLM_MODEL: (.+)$/m)[1].trim();
  const evaluate = new Function('inputs', 'github', 'toJSON',
    `return (${raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`);
  const defaultModel = workflow.split('      llm_model:\n')[1].split('      use_anthropic:\n')[0]
    .match(/        default: "(.*)"/)[1];
  for (const [privateFlag, expected] of [
    [false, 'space-bunny-free'], [true, 'glm-5.3-flash'],
    [undefined, 'glm-5.3-flash'], [null, 'glm-5.3-flash'],
    ['false', 'glm-5.3-flash'], [0, 'glm-5.3-flash'],
  ]) {
    for (const override of ['', 'explicit-provider-model']) {
      assert.equal(evaluate({llm_model:override || defaultModel}, {event:{repository:{private:privateFlag}}},
        value => value === undefined ? 'null' : JSON.stringify(value)), override || expected);
    }
  }
});

test('bounded resumes apply only to large public free Go reviews', () => {
  const raw = workflow.match(/^          OCR_REVIEW_ATTEMPTS: (.+)$/m)[1].trim();
  const evaluate = new Function('inputs', 'github', 'steps', 'toJSON',
    `return (${raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replaceAll('steps.pr-context', "steps['pr-context']")});`);
  for (const [visibility, url, model, files, resolvedFiles, attempts] of [
    [false, 'https://opencode.ai/zen/go/v1', '', 500, undefined, 3],
    [false, 'https://opencode.ai/zen/go/v1/', 'longcat-2.5-preview-free', 1470, undefined, 3],
    [false, 'https://opencode.ai/zen/go/v1', 'space-bunny-free', 500, undefined, 3],
    [false, 'https://opencode.ai/zen/go/v1/', 'space-bunny-free', 1470, undefined, 3],
    [false, 'https://opencode.ai/zen/go/v1', '', undefined, '1470', 3],
    [false, 'https://opencode.ai/zen/go/v1', '', 499, undefined, 1],
    [false, 'https://opencode.ai/zen/go/v1', '', undefined, undefined, 1],
    [false, 'https://opencode.ai/zen/go/v1', 'paid-model', 1470, undefined, 1],
    [true, 'https://opencode.ai/zen/go/v1', 'longcat-2.5-preview-free', 1470, undefined, 1],
    [true, 'https://opencode.ai/zen/go/v1', 'space-bunny-free', 1470, undefined, 1],
    [undefined, 'https://opencode.ai/zen/go/v1', '', 1470, undefined, 1],
    ['false', 'https://opencode.ai/zen/go/v1', '', 1470, undefined, 1],
    [false, 'https://example.com/v1', '', 1470, undefined, 1],
    [false, 'https://example.com/v1', 'space-bunny-free', 1470, undefined, 1],
    [false, 'https://opencode.ai/zen/go/v1/messages', '', 1470, undefined, 1],
  ]) {
    assert.equal(evaluate({llm_url:url,llm_model:model}, {event:{repository:{private:visibility},pull_request:{changed_files:files}}},
      {'pr-context':{outputs:{changed_files:resolvedFiles}}}, value => value === undefined ? 'null' : JSON.stringify(value)), attempts);
  }
});

function runResumeFixture(mode, attempts = 3) {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-resume-'));
  try {
    const head = '1'.repeat(40), session = '11111111-1111-4111-8111-111111111111';
    writeFileSync(join(dir, 'ocr'), `#!/usr/bin/env node
const fs=require('node:fs');
const calls=fs.existsSync(process.env.OCR_CAPTURE)?JSON.parse(fs.readFileSync(process.env.OCR_CAPTURE,'utf8')):[];
calls.push(process.argv.slice(2));fs.writeFileSync(process.env.OCR_CAPTURE,JSON.stringify(calls));
const complete=process.env.OCR_TEST_MODE==='recover'&&calls.length===2;
const sessionDigit=String(calls.length);
const sessionId=sessionDigit.repeat(8)+'-'+sessionDigit.repeat(4)+'-4'+sessionDigit.repeat(3)+'-8'+sessionDigit.repeat(3)+'-'+sessionDigit.repeat(12);
const result={status:complete?'complete':'partial',session_id:sessionId,comments:[{path:'already-reviewed.swift',body:'retained finding'}],
manifest:{schema_version:'ocr.run-manifest/v1',terminal_state:complete?'complete':'partial',input:{resolved_head:'${head}'},
coverage:{selected:[{path:'already-reviewed.swift'},{path:'failed.swift'}],completed:complete?[{path:'failed.swift'}]:[{path:'already-reviewed.swift'}],
reused:complete?[{path:'already-reviewed.swift'}]:[],failed:complete?[]:[{path:'failed.swift'}],waived:[]}}};
if(process.env.OCR_TEST_MODE==='wrong-head')result.manifest.input.resolved_head='2'.repeat(40);
if(process.env.OCR_TEST_MODE==='bad-session')result.session_id='../../arbitrary';
if(process.env.OCR_TEST_MODE==='waived')result.manifest.coverage.waived=[{path:'waived.swift'}];
if(process.env.OCR_TEST_MODE==='legacy')delete result.manifest;
if(calls.length>1&&process.env.OCR_TEST_MODE==='resume-wrong-head')result.manifest.input.resolved_head='2'.repeat(40);
if(calls.length>1&&process.env.OCR_TEST_MODE==='resume-legacy')delete result.manifest;
if(calls.length>1&&process.env.OCR_TEST_MODE==='resume-malformed'){process.stdout.write('not JSON');process.exit(0);}
if(calls.length>1&&process.env.OCR_TEST_MODE==='resume-empty')process.exit(1);
process.stdout.write(process.env.OCR_TEST_MODE==='malformed'?'not JSON':JSON.stringify(result));
`, {mode:0o755});
    const capture = join(dir, 'calls.json'), output = join(dir, 'result.json');
    const body = stepBody('Run OpenCodeReview', 'run')
      .replaceAll('/tmp/ocr-result.json', output).replaceAll('/tmp/ocr-stderr.log', join(dir, 'stderr.log'))
      .replaceAll('/tmp/ocr-previous-result.json', join(dir, 'previous.json'));
    const result = spawnSync('bash', ['-e', '-c', body], {env:{...process.env,PATH:`${dir}:${process.env.PATH}`,
      OCR_CAPTURE:capture,OCR_TEST_MODE:mode,OCR_REVIEW_ATTEMPTS:String(attempts),OCR_REVIEW_CONCURRENCY:'16',
      EVENT_NAME:'pull_request',PR_ACTION:'opened',PR_BASE_REF:'main',PR_HEAD_SHA:head}});
    assert.equal(result.status,0,result.stderr.toString());
    return {calls:JSON.parse(readFileSync(capture,'utf8')),raw:readFileSync(output,'utf8'),session,head};
  } finally {rmSync(dir,{recursive:true});}
}

test('actual review step resumes incomplete coverage and retains findings', () => {
  const {calls,raw,session,head} = runResumeFixture('recover');
  assert.equal(calls.length,2);
  assert.equal(calls[0].includes('--resume'),false);
  assert.equal(calls[1][calls[1].indexOf('--resume')+1],session);
  for (const args of calls) {
    assert.equal(args[args.indexOf('--from')+1],'origin/main');
    assert.equal(args[args.indexOf('--to')+1],head);
    assert.equal(args[args.indexOf('--concurrency')+1],'16');
  }
  const output = JSON.parse(raw);
  assert.equal(output.status,'complete');
  assert.deepEqual(output.comments,[{path:'already-reviewed.swift',body:'retained finding'}]);
  assert.equal(output.manifest.coverage.reused.length+output.manifest.coverage.completed.length,2);
  assert.equal(output.manifest.coverage.failed.length,0);
});

test('resume exhaustion and invalid manifests remain red', async () => {
  const exhausted = runResumeFixture('exhaust');
  assert.equal(exhausted.calls.length,3);
  assert.equal(exhausted.calls[2][exhausted.calls[2].indexOf('--resume')+1],'22222222-2222-4222-8222-222222222222');
  assert.equal(JSON.parse(exhausted.raw).status,'partial');
  // Remove comments to exercise the existing failed-coverage posting path.
  const incomplete = JSON.parse(exhausted.raw);incomplete.comments=[];
  assert.equal((await post(JSON.stringify(incomplete))).failures.length,1);
  for (const mode of ['wrong-head','bad-session','waived','legacy','malformed']) {
    const result = runResumeFixture(mode);
    assert.equal(result.calls.length,1,mode);
  }
  assert.equal(runResumeFixture('recover',1).calls.length,1);
});

test('invalid resume output preserves earlier findings and remains red', async () => {
  for (const mode of ['resume-malformed','resume-empty','resume-legacy','resume-wrong-head']) {
    const {calls,raw,session} = runResumeFixture(mode);
    assert.equal(calls.length,2,mode);
    const result = JSON.parse(raw);
    assert.equal(result.status,'partial',mode);
    assert.equal(result.session_id,session,mode);
    assert.deepEqual(result.comments,[{path:'already-reviewed.swift',body:'retained finding'}],mode);
    // Exercise the existing red coverage gate without needing GitHub line positions.
    result.comments=[];
    assert.equal((await post(JSON.stringify(result))).failures.length,1,mode);
  }
});

test('review progress reaches the job log before the result completes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-progress-'));
  try {
    writeFileSync(join(dir, 'ocr'), '#!/usr/bin/env node\nprocess.stderr.write("synthetic-review-progress\\n");setTimeout(()=>process.stdout.write(JSON.stringify({status:"success",comments:[]})),1000);\n', {mode:0o755});
    // Stream immediately, but delay the saved diagnostic to expose a missing wait.
    writeFileSync(join(dir, 'tee'), '#!/usr/bin/env node\nconst fs=require("node:fs");fs.writeFileSync(process.argv[2],"");let data="";process.stdin.on("data",part=>{data+=part;process.stdout.write(part);});process.stdin.on("end",()=>setTimeout(()=>fs.writeFileSync(process.argv[2],data),2000));\n', {mode:0o755});
    const resultPath = join(dir, 'result.json'), stderrPath = join(dir, 'stderr.log');
    const body = stepBody('Run OpenCodeReview', 'run')
      .replaceAll('/tmp/ocr-result.json', resultPath).replaceAll('/tmp/ocr-stderr.log', stderrPath)
      + '\nnode -e \'require("node:assert/strict").match(require("node:fs").readFileSync(process.env.OCR_TEST_STDERR,"utf8"),/synthetic-review-progress/);\'';
    const child = spawn('bash', ['-e', '-c', body], {
      env:{...process.env,PATH:`${dir}:${process.env.PATH}`,EVENT_NAME:'pull_request',PR_ACTION:'opened',PR_BASE_REF:'main',PR_HEAD_SHA:'synthetic',OCR_TEST_STDERR:stderrPath}
    });
    let progress = false, completedBeforeProgress = false, errors = '';
    child.stdout.resume();
    child.stderr.on('data', chunk => {
      errors += chunk;
      if (!progress && errors.includes('synthetic-review-progress')) {
        progress = true;
        completedBeforeProgress = readFileSync(resultPath, 'utf8').length > 0;
      }
    });
    const exit = await new Promise((resolve, reject) => {child.on('error', reject);child.on('close', resolve);});
    assert.equal(exit, 0, errors);
    assert.equal(progress, true, 'stderr was buffered until the review ended');
    assert.equal(completedBeforeProgress, false, 'progress arrived only after the result');
    assert.deepEqual(JSON.parse(readFileSync(resultPath,'utf8')), {status:'success',comments:[]});
    assert.match(readFileSync(stderrPath,'utf8'), /synthetic-review-progress/);
  } finally {rmSync(dir,{recursive:true});}
});

test('Go gets OCR conversation affinity; other providers keep their headers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-config-'));
  try {
    const bin = join(dir, 'ocr');
    writeFileSync(bin, '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.OCR_CAPTURE, JSON.stringify(process.argv.slice(2))+"\\n");\n', { mode: 0o755 });
    for (const [url, protocol] of [
      ['https://opencode.ai/zen/go/v1', 'false'], ['https://opencode.ai/zen/go/v1/', 'false'],
      ['https://opencode.ai/zen/go/v1/messages', 'true'], ['https://opencode.ai/zen/go/v1/messages/', 'true'],
      ['https://example.com/v1', 'false'], ['https://example.com/v1/messages', 'true'],
    ]) {
      const capture = join(dir, encodeURIComponent(url));
      const result = spawnSync('bash', ['-e', '-c', stepBody('Configure OCR', 'run')], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, OCR_CAPTURE: capture,
          OCR_LLM_URL: url, OCR_LLM_MODEL: 'minimax-m3', OCR_LLM_AUTH_TOKEN: 'synthetic', OCR_USE_ANTHROPIC: protocol }
      });
      assert.equal(result.status, 0, result.stderr.toString());
      const calls = readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse);
      const headers = calls.filter(call => call[2] === 'llm.extra_headers');
      assert.deepEqual(headers, url.startsWith('https://opencode.ai/')
        ? [['config', 'set', 'llm.extra_headers', 'x-opencode-session={ocr_session_key}']] : []);
      assert.deepEqual(calls.filter(call => call[2] === 'llm.use_anthropic'), [['config','set','llm.use_anthropic',protocol]]);
      assert.deepEqual(calls.filter(call => call[2] === 'llm.auth_header'), url.startsWith('https://opencode.ai/') && url.includes('/messages')
        ? [['config','set','llm.auth_header',''],['config','set','llm.auth_header','x-api-key']] : [['config','set','llm.auth_header','']]);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

async function post(raw) {
  const calls = [], failures = [];
  const fakeRequire = name => name === 'fs'
    ? { readFileSync: path => path === '/tmp/ocr-result.json' ? raw : 'synthetic provider failure' }
    : require(name);
  const fn = new (Object.getPrototypeOf(async function() {}).constructor)(
    'require', 'github', 'context', 'core', stepBody('Post review comments to PR', 'script'));
  await fn(fakeRequire, { rest: { issues: { createComment: async arg => calls.push(arg.body) } } },
    { repo: { owner: 'test', repo: 'repo' }, issue: { number: 1 } }, { setFailed: message => failures.push(message) });
  return { calls, failures };
}

test('failed review is red and never claims a clean review', async () => {
  const result = await post(JSON.stringify({ status: 'failed', message: 'All selected files failed', comments: [] }));
  assert.deepEqual(result.failures, ['All selected files failed']);
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0], /^⚠️/);
  assert.doesNotMatch(result.calls[0], /✅|Looks good/);
});

test('invalid review output fails the check', async () => {
  const result = await post('not JSON');
  assert.equal(result.failures.length, 1);
  assert.match(result.calls[0], /^⚠️/);
});

test('completed empty review stays green', async () => {
  const result = await post(JSON.stringify({ status: 'success', comments: [], message: 'Review completed' }));
  assert.deepEqual(result.failures, []);
  assert.match(result.calls[0], /^✅/);
});

test('partial reviews with failed coverage never claim green', async () => {
  for (const status of ['partial', 'completed_with_errors', 'completed_with_warnings']) {
    const result = await post(JSON.stringify({ status, comments: [], coverage: { failed: [{ path: 'unreviewed.swift' }] } }));
    assert.equal(result.failures.length, 1);
    assert.equal(result.calls.length, 1);
    assert.match(result.calls[0], /^⚠️/);
  }
});

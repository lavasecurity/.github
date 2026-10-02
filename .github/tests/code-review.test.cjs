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
    ['pull_request', 499, 30], ['pull_request', 500, 90],
    ['pull_request', 1470, 90], ['issue_comment', undefined, 90],
  ]) {
    assert.equal(evaluate({event_name:event,event:{pull_request:{changed_files:files}}}), minutes, `${event}: ${files}`);
  }
});

test('review progress reaches the job log before the result completes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-progress-'));
  try {
    writeFileSync(join(dir, 'ocr'), '#!/usr/bin/env node\nprocess.stderr.write("synthetic-review-progress\\n");setTimeout(()=>process.stdout.write(JSON.stringify({status:"success",comments:[]})),1000);\n', {mode:0o755});
    const resultPath = join(dir, 'result.json'), stderrPath = join(dir, 'stderr.log');
    const body = stepBody('Run OpenCodeReview', 'run')
      .replaceAll('/tmp/ocr-result.json', resultPath).replaceAll('/tmp/ocr-stderr.log', stderrPath);
    const child = spawn('bash', ['-e', '-c', body], {
      env:{...process.env,PATH:`${dir}:${process.env.PATH}`,EVENT_NAME:'pull_request',PR_ACTION:'opened',PR_BASE_REF:'main',PR_HEAD_SHA:'synthetic'}
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
        ? [['config','set','llm.auth_header','x-api-key']] : []);
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

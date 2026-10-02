const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const workflow = readFileSync(join(__dirname, '../workflows/code-review.yml'), 'utf8');
function stepBody(name, key) {
  const step = workflow.split(`      - name: ${name}\n`)[1].split('\n      - name: ')[0];
  const body = step.split(`        ${key}: |\n`)[1] || step.split(`          ${key}: |\n`)[1];
  return body.split('\n').filter(line => line.startsWith('          ')).map(line => line.replace(/^ {10,12}/, '')).join('\n');
}

test('Go gets OCR conversation affinity; other providers keep their headers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-config-'));
  try {
    const bin = join(dir, 'ocr');
    writeFileSync(bin, '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.OCR_CAPTURE, JSON.stringify(process.argv.slice(2))+"\\n");\n', { mode: 0o755 });
    for (const url of ['https://opencode.ai/zen/go/v1', 'https://opencode.ai/zen/go/v1/', 'https://example.com/v1']) {
      const capture = join(dir, encodeURIComponent(url));
      const result = spawnSync('bash', ['-e', '-c', stepBody('Configure OCR', 'run')], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, OCR_CAPTURE: capture,
          OCR_LLM_URL: url, OCR_LLM_MODEL: 'minimax-m3', OCR_LLM_AUTH_TOKEN: 'synthetic', OCR_USE_ANTHROPIC: 'false' }
      });
      assert.equal(result.status, 0, result.stderr.toString());
      const calls = readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse);
      const headers = calls.filter(call => call[2] === 'llm.extra_headers');
      assert.deepEqual(headers, url.startsWith('https://opencode.ai/')
        ? [['config', 'set', 'llm.extra_headers', 'x-opencode-session={ocr_session_key}']] : []);
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

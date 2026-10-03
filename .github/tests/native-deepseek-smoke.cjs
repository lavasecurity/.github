// Offline protocol check using the installed OCR CLI, not a replacement client.
// OCR_BINARY=/path/to/ocr node .github/tests/native-deepseek-smoke.cjs
const http = require('node:http');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');

(async () => {
  const requests = [];
  let serverError;
  const server = http.createServer((req,res) => {
    let bytes = '';
    req.on('data',part => bytes += part);
    req.on('end',() => {
      try {
        const body = JSON.parse(bytes);
        assert.equal(req.url,'/chat/completions');
        assert.equal(body.model,'deepseek-flash');
        assert.ok(req.headers.authorization === 'Bearer synthetic','Expected synthetic bearer auth');
        assert.equal(req.headers['x-opencode-session'],undefined);
        assert.match(req.headers['user-agent'],/open-code-review\//);
        const first = requests.length === 0;
        requests.push(body);
        const tool = body.tools.find(tool => tool.function?.name === 'ocr_selftest');
        assert.ok(tool);
        const args = Object.fromEntries(Object.keys(tool.function.parameters.properties ?? {}).map(key => [key,'synthetic acknowledgement']));
        if (!first) {
          const result = body.messages.find(message => message.role === 'tool');
          assert.equal(result.tool_call_id,'synthetic-call');
          assert.ok(result.content);
          const assistant = body.messages.find(message => message.role === 'assistant');
          assert.equal(assistant.tool_calls[0].id,'synthetic-call');
          assert.equal(assistant.reasoning_content,'synthetic reasoning');
        }
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({id:'synthetic',object:'chat.completion',created:1,model:'deepseek-flash',
          choices:[{index:0,message:first ? {role:'assistant',content:null,reasoning_content:'synthetic reasoning',
            tool_calls:[{id:'synthetic-call',type:'function',function:{name:'ocr_selftest',arguments:JSON.stringify(args)}}]}
            : {role:'assistant',content:'Tool acknowledgement received'},finish_reason:first ? 'tool_calls' : 'stop'}],
          usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
      } catch(error) {serverError=error;res.writeHead(500);res.end('synthetic assertion failed');}
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const child = spawn(process.env.OCR_BINARY || 'ocr',['llm','test'],{env:{...process.env,
      OCR_LLM_URL:`http://127.0.0.1:${server.address().port}`,OCR_LLM_MODEL:'deepseek-flash',
      OCR_LLM_TOKEN:'synthetic',OCR_LLM_PROTOCOL:'openai',OCR_LLM_AUTH_HEADER:'authorization',
      OCR_LLM_EXTRA_HEADERS:'x-ocr-mock=synthetic',OCR_LLM_TIMEOUT:'5'}});
    let output='';
    child.stdout.on('data',part => output += part);child.stderr.on('data',part => output += part);
    const timer=setTimeout(() => child.kill('SIGTERM'),30000);
    let code;
    try {code=await new Promise((resolve,reject) => {child.on('error',reject);child.on('close',resolve);});}
    finally {clearTimeout(timer);}
    if(serverError)throw serverError;
    assert.equal(code,0,output);
    assert.equal(requests.length,2,output);
    assert.match(output,/Tool-call round trip verified/);
    console.log('Native OCR: direct Chat Completions, bearer auth, tool results, and reasoning replay verified.');
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});

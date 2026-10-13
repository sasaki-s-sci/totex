"""Deterministic ACP peer; the terminal transcript arrives inside the prompt."""
import json
import os
import sys

log_path, control_path = sys.argv[1:]
FIELDS = ['status', 'agents', 'taskSummary', 'requestSummary', 'estimate', 'goal']

def emit(value):
    print(json.dumps(value), flush=True)

def log(value):
    with open(log_path, 'a') as output:
        output.write(json.dumps(value) + '\n')

for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method')
    params = request.get('params', {})
    if method == 'initialize':
        assert params['protocolVersion'] == 1
        result = {'protocolVersion': 1, 'agentCapabilities': {}}
    elif method == 'session/new':
        assert os.getcwd() == params['cwd']
        assert '/totex/monitor/' in params['cwd']
        assert params['mcpServers'] == []
        log({'event': 'session', 'pid': os.getpid(), 'cwd': os.getcwd()})
        result = {'sessionId': 'e2e', 'configOptions': [{'id': 'model', 'name': 'Model', 'category': 'model', 'type': 'select', 'currentValue': 'default', 'options': [{'value': 'e2e-model', 'name': 'E2E'}]}]}
    elif method == 'session/set_config_option':
        assert params['configId'] == 'model' and params['value'] == 'e2e-model'
        log({'event': 'model', 'value': params['value']})
        result = {'configOptions': []}
    elif method == 'session/prompt':
        prompt = params['prompt'][0]['text']
        fields = [field for field in FIELDS if f'- {field}:' in prompt]
        log({'event': 'prompt', 'fields': fields, 'transcript': 'MONITOR_NATIVE_E2E' in prompt})
        if os.path.exists(control_path) and open(control_path).read() == 'stall':
            log({'event': 'stall', 'pid': os.getpid(), 'cwd': os.getcwd()})
            continue
        assert 'MONITOR_NATIVE_E2E' in prompt, prompt
        values = {'status': 'running', 'taskSummary': 'Implement native monitor verification', 'requestSummary': 'Verify monitor through a real terminal', 'goal': {'status': 'active', 'summary': 'Complete native monitor checks'}, 'estimate': {'seconds': 180, 'confidence': 'medium'}, 'agents': [{'id': 'test-worker', 'kind': 'subagent', 'label': 'Tests', 'status': 'running', 'detail': 'Checking native behavior', 'progress': 45}, {'id': 'background-worker', 'kind': 'background', 'label': 'Build', 'status': 'running', 'detail': 'Building application', 'progress': 70}]}
        report = {field: values[field] for field in fields}
        log({'event': 'report', 'report': report})
        emit({'jsonrpc': '2.0', 'method': 'session/update', 'params': {'sessionId': 'e2e', 'update': {'sessionUpdate': 'agent_message_chunk', 'content': {'type': 'text', 'text': 'I will inspect the terminal evidence.\n' + json.dumps(report)}}}})
        result = {'stopReason': 'end_turn'}
    else:
        continue
    emit({'jsonrpc': '2.0', 'id': request['id'], 'result': result})

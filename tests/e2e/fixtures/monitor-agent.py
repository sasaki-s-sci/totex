"""Deterministic ACP peer; exercises the native observer and its actual MCP server."""
import json
import os
import subprocess
import sys

log_path, control_path = sys.argv[1:]
server_process = None

def emit(value):
    print(json.dumps(value), flush=True)

def log(value):
    with open(log_path, 'a') as output:
        output.write(json.dumps(value) + '\n')

def mcp(method, params=None):
    server_process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or {}}) + '\n')
    server_process.stdin.flush()
    reply = json.loads(server_process.stdout.readline())
    assert 'error' not in reply, reply
    return reply['result']

try:
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
            server, = params['mcpServers']
            env = dict(os.environ)
            env.update({item['name']: item['value'] for item in server['env']})
            server_process = subprocess.Popen([server['command']] + server['args'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            mcp('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'e2e', 'version': '1'}})
            tool_names = [tool['name'] for tool in mcp('tools/list')['tools']]
            transcript = mcp('tools/call', {'name': 'read_terminal'})['content'][0]['text']
            log({'event': 'session', 'tools': tool_names, 'transcript': transcript, 'pid': os.getpid(), 'cwd': os.getcwd()})
            result = {'sessionId': 'e2e', 'configOptions': [{'id': 'model', 'name': 'Model', 'category': 'model', 'type': 'select', 'currentValue': 'default', 'options': [{'value': 'e2e-model', 'name': 'E2E'}]}]}
        elif method == 'session/set_config_option':
            assert params['configId'] == 'model' and params['value'] == 'e2e-model'
            log({'event': 'model', 'value': params['value']})
            result = {'configOptions': []}
        elif method == 'session/prompt':
            prompt = params['prompt'][0]['text']
            for field in ['status', 'agents', 'taskSummary', 'requestSummary', 'estimate', 'goal']:
                assert (f'- {field}:' in prompt) == (f'report_{field}' in tool_names)
            if os.path.exists(control_path) and open(control_path).read() == 'stall':
                server_process.stdin.close()
                server_process.wait(timeout=2)
                log({'event': 'stall', 'pid': os.getpid(), 'cwd': os.getcwd()})
                continue
            assert 'MONITOR_NATIVE_E2E' in transcript, transcript
            values = {'status': 'running', 'taskSummary': 'Implement native monitor verification', 'requestSummary': 'Verify monitor through a real terminal', 'goal': {'status': 'active', 'summary': 'Complete native monitor checks'}, 'estimate': {'seconds': 180, 'confidence': 'medium'}, 'agents': [{'id': 'test-worker', 'kind': 'subagent', 'label': 'Tests', 'status': 'running', 'detail': 'Checking native behavior', 'progress': 45}, {'id': 'background-worker', 'kind': 'background', 'label': 'Build', 'status': 'running', 'detail': 'Building application', 'progress': 70}]}
            for field, value in values.items():
                if 'report_' + field in tool_names:
                    reply = mcp('tools/call', {'name': 'report_' + field, 'arguments': {'value': value}})
                    assert not reply.get('isError'), reply
            if 'report_estimate' not in tool_names:
                assert mcp('tools/call', {'name': 'report_estimate', 'arguments': {'value': values['estimate']}})['isError']
            report = mcp('tools/call', {'name': 'read_report'})['content'][0]['text']
            log({'event': 'report', 'report': json.loads(report)})
            server_process.stdin.close()
            server_process.wait(timeout=2)
            emit({'jsonrpc': '2.0', 'method': 'session/update', 'params': {'sessionId': 'e2e', 'update': {'sessionUpdate': 'agent_message_chunk', 'content': {'type': 'text', 'text': 'I will inspect the terminal evidence.\n' + report}}}})
            result = {'stopReason': 'end_turn'}
        else:
            continue
        emit({'jsonrpc': '2.0', 'id': request['id'], 'result': result})
finally:
    if server_process and server_process.poll() is None:
        server_process.terminate()
        server_process.wait(timeout=2)

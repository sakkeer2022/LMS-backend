"""Read-only, standard-library structural checks; NOT a full OpenAPI validator."""
import json
import re
from pathlib import Path

path = Path(__file__).with_name('openapi.yaml')
spec = json.loads(path.read_text(encoding='utf-8'))
assert spec['openapi'] == '3.0.3'
assert spec['servers'][0]['url'] == '/api/v1'

def resolve(reference):
    assert reference.startswith('#/'), f'Unexpected external ref: {reference}'
    node = spec
    for part in reference[2:].split('/'):
        node = node[part.replace('~1', '/').replace('~0', '~')]
    return node

def walk(value):
    if isinstance(value, dict):
        if '$ref' in value:
            resolve(value['$ref'])
        if value.get('type') == 'object' and 'required' in value:
            assert value['required'], 'OpenAPI required arrays must not be empty'
            assert set(value['required']) <= set(value.get('properties', {}))
        for child in value.values():
            walk(child)
    elif isinstance(value, list):
        for child in value:
            walk(child)

walk(spec)
ids = set()
operations = 0
decision_required = 0
for endpoint, methods in spec['paths'].items():
    assert not re.search(r'/(bookings?|payments?|sessions/live|earnings|payouts?|availability|homework|reviews|reports|backups|deployments)(/|$)', endpoint), endpoint
    for method, operation in methods.items():
        assert method in {'get', 'post', 'put', 'patch', 'delete'}
        name = operation['operationId']
        assert name not in ids, name
        ids.add(name)
        operations += 1
        assert operation['tags'] and operation['summary'] and operation['description']
        assert operation['x-review-status'] in {'ready-for-review', 'decision-required'}
        decision_required += operation['x-review-status'] == 'decision-required'
        parameters = [resolve(p['$ref']) if '$ref' in p else p for p in operation.get('parameters', [])]
        pairs = [(p['in'], p['name']) for p in parameters]
        assert len(pairs) == len(set(pairs)), name
        expected = set(re.findall(r'\{(\w+)\}', endpoint))
        actual = {p['name'] for p in parameters if p['in'] == 'path' and p['required']}
        assert expected == actual, (name, expected, actual)
        if method != 'get':
            assert ('header', 'x-csrf-token') in pairs, name
        if operation['x-required-role'] == 'public':
            assert operation['security'] == [], name
        else:
            assert operation['security'], name
            assert '401' in operation['responses'], name
        assert any(code.startswith('2') for code in operation['responses']), name
        for code, response in operation['responses'].items():
            assert re.fullmatch(r'[1-5][0-9]{2}', code)
            response = resolve(response['$ref']) if '$ref' in response else response
            assert response['description']
            for media in response.get('content', {}).values():
                assert 'schema' in media
        body = operation.get('requestBody')
        if body:
            assert body['required'] and body['content'], name
            for media in body['content'].values():
                assert 'schema' in media
        for response in operation['responses'].values():
            schema = response.get('content', {}).get('application/json', {}).get('schema', {})
            if '$ref' in schema:
                resolved = resolve(schema['$ref'])
                if 'meta' in resolved.get('properties', {}):
                    assert ('query', 'page') in pairs and ('query', 'limit') in pairs, name

assert '/auth/student/login' in spec['paths']
assert '/auth/faculty/login' in spec['paths']
assert '/auth/admin/login' in spec['paths']
assert '/auth/login' not in spec['paths']
assert '/auth/faculty/register' not in spec['paths']
assert '/auth/admin/register' not in spec['paths']
print(f'PASS structural checks: {len(spec["paths"])} paths, {operations} unique operations, {len(spec["components"]["schemas"])} schemas, {decision_required} decision-required operations; all local references resolve.')
print('Full OpenAPI standards validation, schema/example conformance, and implemented API conformance remain pending. No database or network access performed.')

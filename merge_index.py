#!/usr/bin/env python3
"""
merge_index.py - merge source files per directory + build a compact INDEX.md

Usage:
  python merge_index.py                          # asks for the folder
  python merge_index.py path/to/project
  python merge_index.py path/to/project --sql
  python merge_index.py path/to/project --exts php,js,py --max-symbols 6
  python merge_index.py path/to/project --no-deps --folders-only
  python merge_index.py path/to/project --clean      # wipe old .txt first (INDEX.md kept)

Packing groups/modules into upload-ready bundles (AI workflow, stage 2):
  python merge_index.py pack path/to/project                     # first run: write .ai-context/groups.json draft
  python merge_index.py pack path/to/project --list-groups       # groups + token estimates + unassigned files
  python merge_index.py pack path/to/project -g mod-bot --deps   # bundle one group + its direct dependencies
  python merge_index.py pack path/to/project -g a,b --one-file --deps

Bundles go to <project>/.ai-context/bundles/: header (project, date, file
list with line counts + sha1) + a short AI output contract + every file
between "=== FILE: path ===" / "=== END FILE ===" separators. A manifest
and a base copy of every bundled file are kept under .ai-context/bases/
so the future "apply output" step can diff and 3-way merge. Secrets
(.env, keys, vendor/node_modules/storage/uploads, ...) are NEVER packed.
groups.json is written once as a draft and never auto-rewritten afterwards
(rename groups, adjust paths/patterns; new unassigned files are reported).

Output goes to a folder named "merged" next to this script (or --out):
  <project>.txt, <project>__app__Controllers.txt, ...   one file per directory
  INDEX.md                                               compact map of the project

Incremental mode (default): every run only writes the .txt file of each
 directory it merges, overwriting duplicates - files produced by earlier
merges of OTHER folders are kept untouched. Stale .txt files that belong to
the currently merged project (folders renamed/deleted since the last run)
are removed, so its own output always matches the current project.

INDEX.md is NEVER deleted: every merged root gets its own section and
re-merging the same root UPDATES that section in place instead of appending
a duplicate. A small table of contents at the top lists all merged projects.
Standard library only (Python 3.8+).
"""
import argparse
import ast
import fnmatch
import hashlib
import json
import os
import posixpath
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime

# ------------------------------------------------------------------ settings
DEFAULT_EXTS = 'php,js,mjs,cjs,jsx,ts,tsx,py'
SKIP_DIRS = {
    'node_modules', 'vendor', '.git', '.idea', '.vscode', '.next', 'dist', 'build',
    'storage', 'cache', 'logs', 'log', 'uploads', 'tmp', 'temp', '__pycache__',
    'venv', '.venv', 'site-packages', 'coverage',
}
SKIP_SUFFIXES = ('.min.js', '.min.css', '.d.ts')
MAX_FILE_BYTES = 1_000_000          # bigger files are skipped (and listed in INDEX)
AUTO_FOLDERS_ONLY_ABOVE = 400       # more files than this -> folder-level index only
MAX_FILES_PER_FOLDER = 25           # per-folder file lines in INDEX
MAX_DEPS_SHOWN = 6
MAX_PKGS_SHOWN = 40
MAX_TABLE_FILES = 6

LANG = {'.php': 'php', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js',
        '.ts': 'js', '.tsx': 'js', '.py': 'py'}
JS_EXTS = ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs')

KEY_NAMES = {
    'index.php', 'main.py', 'app.py', 'manage.py', 'wsgi.py', 'asgi.py', 'server.js',
    'app.js', 'index.js', 'main.js', 'main.ts', 'index.ts', 'package.json',
    'composer.json', 'requirements.txt', 'pyproject.toml', 'dockerfile',
    'docker-compose.yml', 'docker-compose.yaml', '.env.example', 'readme.md',
    'next.config.js', 'next.config.mjs', 'vite.config.js', 'vite.config.ts',
    'tsconfig.json', 'nest-cli.json', 'artisan', 'schema.prisma', '.htaccess',
}
MANIFESTS = {'package.json', 'composer.json', 'requirements.txt'}

ROLE_NAMES = {
    'controllers': ('controller', 'controllers', 'handler', 'handlers'),
    'models': ('model', 'models', 'entity', 'entities', 'schema', 'schemas'),
    'views': ('view', 'views', 'template', 'templates', 'pages', 'layouts', 'partials'),
    'routes': ('route', 'routes', 'router', 'routers'),
    'services': ('service', 'services', 'usecases'),
    'repositories': ('repository', 'repositories', 'repos'),
    'middleware': ('middleware', 'middlewares'),
    'components': ('component', 'components', 'ui'),
    'hooks': ('hook', 'hooks'),
    'tests': ('test', 'tests', '__tests__', 'spec', 'specs', 'e2e'),
    'migrations': ('migration', 'migrations', 'seeds', 'seeders', 'database'),
    'config': ('config', 'configs', 'configuration', 'settings'),
    'utils': ('util', 'utils', 'helper', 'helpers', 'lib', 'libs', 'common', 'shared'),
    'api': ('api', 'apis', 'endpoints'),
    'public': ('public', 'static', 'assets', 'resources'),
    'commands': ('command', 'commands', 'console', 'cli', 'jobs', 'queue', 'queues', 'workers'),
    'modules': ('module', 'modules'),
}
ROLE_OF = {}
for _role, _names in ROLE_NAMES.items():
    for _n in _names:
        ROLE_OF.setdefault(_n, _role)

SQL_STOP = {'select', 'set', 'where', 'values', 'dual', 'as', 'on', 'and', 'or',
            'information_schema', 'if', 'not', 'exists', 'table', 'the', 'from',
            'into', 'join', 'left', 'right', 'inner', 'outer'}

# ------------------------------------------------------------------ cleaning
_STR = r"'(?:\\.|[^'\\\n])*'" + r'|"(?:\\.|[^"\\\n])*"'
CLEAN = {
    'php': re.compile(r"(?P<s>" + _STR + r")|(?P<c>/\*.*?\*/|//[^\n]*|#(?!\[)[^\n]*)", re.S),
    'js': re.compile(r"(?P<s>" + _STR + r"|`(?:\\.|[^`\\])*`)|(?P<c>/\*.*?\*/|//[^\n]*)", re.S),
    'py': re.compile(r"(?P<s>'''.*?'''|\"\"\".*?\"\"\"|" + _STR + r")|(?P<c>#[^\n]*)", re.S),
}


def clean(text, lang):
    """Remove comments (keep line breaks), keep strings."""
    rx = CLEAN.get(lang)
    if rx is None:
        return text

    def rep(m):
        if m.group('s') is not None:
            return m.group('s')
        return re.sub(r'[^\n]', '', m.group('c'))
    return rx.sub(rep, text)


def read_text(path):
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError:
        return ''
    for enc in ('utf-8-sig', 'cp1256'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode('latin-1')


def count_lines(text):
    return text.count('\n') + (1 if text and not text.endswith('\n') else 0)


# ------------------------------------------------------------------ symbols
PHP_CLASS = re.compile(r'(?m)^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+(\w+)')
PHP_FUNC = re.compile(r'(?m)^\s*(?:(?:public|protected|private|static|abstract|final)\s+)*function\s+&?(\w+)\s*\(')
JS_CLASS = re.compile(r'(?m)^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)')
JS_TYPE = re.compile(r'(?m)^(?:export\s+)?(?:declare\s+)?(interface|type|enum)\s+(\w+)')
JS_FUNC = re.compile(r'(?m)^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)')
JS_ARROW = re.compile(
    r'(?m)^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?'
    r'(?:\([^)\n]*\)|\w+)\s*(?::[^=\n]+)?=>')
JS_FUNC_EXPR = re.compile(r'(?m)^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\b')
ROUTE = re.compile(
    r'''\b(?:app|router|route|Route|api)\s*(?:\.|->|::)\s*(get|post|put|patch|delete|any)\s*\(\s*['"]([^'"]*)['"]''')
PY_ROUTE = re.compile(r'''@\w+\.(route|get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]''')
PY_CLASS_RX = re.compile(r'(?m)^class\s+(\w+)')
PY_DEF_RX = re.compile(r'(?m)^(?:async\s+)?def\s+([A-Za-z]\w*)')
CAT_ORDER = {'class': 0, 'type': 1, 'fn': 2, 'route': 3}


def extract(raw, text, lang):
    """Return (symbols, python_imports). symbols = [(category, label)]."""
    syms, pyimps = [], []
    if lang == 'php':
        for m in PHP_CLASS.finditer(text):
            syms.append(('class', f'{m.group(1)} {m.group(2)}'))
        for m in PHP_FUNC.finditer(text):
            syms.append(('fn', m.group(1)))
        for m in ROUTE.finditer(text):
            syms.append(('route', f'{m.group(1).upper()} {m.group(2)}'))
    elif lang == 'js':
        for m in JS_CLASS.finditer(text):
            syms.append(('class', f'class {m.group(1)}'))
        for m in JS_TYPE.finditer(text):
            syms.append(('type', f'{m.group(1)} {m.group(2)}'))
        for rx in (JS_FUNC, JS_ARROW, JS_FUNC_EXPR):
            for m in rx.finditer(text):
                syms.append(('fn', m.group(1)))
        for m in ROUTE.finditer(text):
            syms.append(('route', f'{m.group(1).upper()} {m.group(2)}'))
    elif lang == 'py':
        tree = None
        try:
            tree = ast.parse(raw)
        except Exception:
            pass
        if tree is not None:
            for node in tree.body:
                if isinstance(node, ast.ClassDef):
                    syms.append(('class', f'class {node.name}'))
                    for sub in node.body:
                        if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            syms.append(('fn', sub.name))
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    syms.append(('fn', node.name))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for a in node.names:
                        pyimps.append((0, a.name, []))
                elif isinstance(node, ast.ImportFrom):
                    pyimps.append((node.level or 0, node.module or '', [a.name for a in node.names]))
        else:
            for m in PY_CLASS_RX.finditer(text):
                syms.append(('class', f'class {m.group(1)}'))
            for m in PY_DEF_RX.finditer(text):
                syms.append(('fn', m.group(1)))
        for m in PY_ROUTE.finditer(text):
            verb = 'ANY' if m.group(1) == 'route' else m.group(1).upper()
            syms.append(('route', f'{verb} {m.group(2)}'))
    return syms, pyimps


def fmt_symbols(syms, cap):
    items, seen = [], set()
    for cat, label in sorted(syms, key=lambda s: CAT_ORDER[s[0]]):
        name = label.split()[-1] if cat in ('class', 'type', 'fn') else label
        if name.startswith('_') or label in seen:
            continue
        seen.add(label)
        items.append((cat, label))
    if not items:
        return '-'
    shown = items[:cap]
    extra = len(items) - len(shown)
    head = ', '.join(l for c, l in shown if c in ('class', 'type'))
    tail = ', '.join(l for c, l in shown if c in ('fn', 'route'))
    if extra:
        if tail:
            tail += f', +{extra}'
        else:
            head += f', +{extra}'
    return '; '.join(p for p in (head, tail) if p)


# ------------------------------------------------------------------ dependencies
PHP_USE = re.compile(r'(?m)^use\s+(?!function\b|const\b)([^;]+);')
PHP_NEW = re.compile(r'\bnew\s+\\?([\w\\]+)')
PHP_STATIC = re.compile(r'(?<![\w$>])\\?([A-Z][\w\\]*)::')
PHP_INSTANCEOF = re.compile(r'\binstanceof\s+\\?([\w\\]+)')
PHP_EXTENDS = re.compile(r'\b(?:extends|implements)\s+([\w\\\s,]+?)\s*(?:\{|implements\b)')
PHP_REQ = re.compile(
    r'''\b(?:require|include)(?:_once)?\b\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+\.php)['"]''')
JS_IMPORT = re.compile(
    r'''(?:\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?|\bexport\s+(?:\*|\{[^}]*\})\s+from\s+'''
    r'''|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]''')


def php_refs(text):
    names = set()
    for m in PHP_USE.finditer(text):
        stmt = m.group(1).strip()
        grp = re.match(r'([\w\\]+)\\\{(.+)\}$', stmt, re.S)
        parts = ([p for p in grp.group(2).split(',')] if grp
                 else stmt.split(','))
        for p in parts:
            p = re.split(r'\s+as\s+', p.strip(), flags=re.I)[0].strip()
            if p:
                names.add(p.split('\\')[-1])
    for rx in (PHP_NEW, PHP_STATIC, PHP_INSTANCEOF):
        for m in rx.finditer(text):
            names.add(m.group(1).split('\\')[-1])
    for m in PHP_EXTENDS.finditer(text):
        for n in re.split(r'[,\s]+', m.group(1)):
            if n:
                names.add(n.split('\\')[-1])
    return names


def resolve_js(spec, from_rel, fileset):
    if spec.startswith('.'):
        bases = [posixpath.normpath(posixpath.join(posixpath.dirname(from_rel), spec))]
    elif spec.startswith(('@/', '~/')):
        sub = spec[2:]
        bases = [sub, 'src/' + sub]
    else:
        return None
    for b in bases:
        if b.startswith('..'):
            continue
        cands = [b] + [b + e for e in JS_EXTS] + [b + '/index' + e for e in JS_EXTS]
        m = re.match(r'(.+)\.(?:js|jsx|mjs|cjs)$', b)
        if m:
            cands += [m.group(1) + e for e in ('.ts', '.tsx')]
        for c in cands:
            if c in fileset:
                return c
    return None


def resolve_py(level, module, names, from_rel, fileset):
    cur = posixpath.dirname(from_rel)
    if level:
        base = cur
        for _ in range(level - 1):
            base = posixpath.dirname(base)
        bases = [base]
    else:
        bases = ['', cur, 'src']
    path = module.replace('.', '/') if module else ''
    for b in bases:
        p = posixpath.join(b, path) if path else b
        p = posixpath.normpath(p) if p else ''
        if p == '.':
            p = ''
        if p.startswith('..'):
            continue
        found = []
        if p:
            for c in (p + '.py', p + '/__init__.py'):
                if c in fileset:
                    found.append(c)
        for n in names:
            q = posixpath.join(p, n) if p else n
            for c in (q + '.py', q + '/__init__.py'):
                if c in fileset:
                    found.append(c)
        if found:
            return found
    return []


def build_deps(files):
    """Folder -> folder edges. Returns {src_dir: Counter({dst_dir: n})}."""
    fileset = {f['rel'] for f in files}
    class_dirs = defaultdict(set)
    for f in files:
        if f['lang'] == 'php':
            for cat, label in f['syms']:
                if cat == 'class':
                    class_dirs[label.split()[-1]].add(f['dir'])
    edges = defaultdict(Counter)
    for f in files:
        targets = {}  # key -> dst dir
        text = f['text']
        if f['lang'] == 'php':
            for name in php_refs(text):
                ds = class_dirs.get(name)
                if ds and len(ds) == 1:
                    targets['cls:' + name] = next(iter(ds))
            for m in PHP_REQ.finditer(text):
                spec = m.group(1)
                cands = [posixpath.normpath(posixpath.join(posixpath.dirname(f['rel']), spec.lstrip('/'))),
                         posixpath.normpath(spec.lstrip('/'))]
                for c in cands:
                    if c in fileset:
                        targets['file:' + c] = posixpath.dirname(c) or '.'
                        break
        elif f['lang'] == 'js':
            for spec in JS_IMPORT.findall(text):
                r = resolve_js(spec, f['rel'], fileset)
                if r:
                    targets['file:' + r] = posixpath.dirname(r) or '.'
        elif f['lang'] == 'py':
            for level, module, names in f['pyimps']:
                for r in resolve_py(level, module, names, f['rel'], fileset):
                    targets['file:' + r] = posixpath.dirname(r) or '.'
        for dst in targets.values():
            if dst != f['dir']:
                edges[f['dir']][dst] += 1
    return edges


# ------------------------------------------------------------------ sql
SQL_RX = [
    re.compile(r'\bINSERT\s+(?:IGNORE\s+)?INTO\s+[`"\[]?(\w+)', re.I),
    re.compile(r'\bUPDATE\s+[`"\[]?(\w+)[`"\]]?\s+SET\b', re.I),
    re.compile(r'\bDELETE\s+FROM\s+[`"\[]?(\w+)', re.I),
    re.compile(r'\bREPLACE\s+INTO\s+[`"\[]?(\w+)', re.I),
    re.compile(r'''\bSELECT\b[^;'"`]{0,400}?\bFROM\s+[`"\[]?(\w+)''', re.I),
    re.compile(r'\bJOIN\s+[`"\[]?(\w+)[`"\]]?(?:\s+(?:AS\s+)?\w+)?\s+ON\b', re.I),
    re.compile(r'''(?:->|::|\.)(?:table|insertInto)\s*\(\s*['"`](\w+)['"`]'''),
    re.compile(r'''->(?:from|into|join|leftJoin|rightJoin|innerJoin)\s*\(\s*['"`](\w+)['"`]'''),
]
SQL_CREATE = re.compile(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)', re.I)


def scan_tables(files):
    tables = defaultdict(set)
    for f in files:
        found = set()
        for rx in SQL_RX:
            found.update(rx.findall(f['text']))
        for n in found:
            n = n.lower()
            if len(n) > 1 and n not in SQL_STOP:
                tables[n].add(f['rel'])
    return tables


# ------------------------------------------------------------------ manifests
def read_manifests(root, rels):
    out = []
    for rel in rels:
        path = os.path.join(root, rel)
        names = []
        low = os.path.basename(rel).lower()
        text = read_text(path)
        if low in ('package.json', 'composer.json'):
            try:
                data = json.loads(text)
            except ValueError:
                continue
            keys = (('dependencies', 'devDependencies') if low == 'package.json'
                    else ('require', 'require-dev'))
            for k in keys:
                for n in (data.get(k) or {}):
                    if n == 'php' or n.startswith('ext-'):
                        continue
                    names.append(n)
        else:
            for line in text.splitlines():
                line = line.split('#')[0].strip()
                if not line or line.startswith('-'):
                    continue
                n = re.split(r'[=<>~!;\s\[]', line)[0]
                if n:
                    names.append(n)
        if names:
            out.append((rel, names))
    return out


# ------------------------------------------------------------------ output
def fmt_tok(n):
    return f'~{round(n / 1000)}k tok' if n >= 1000 else f'~{n} tok'


def txt_name(base, rel_dir):
    name = base if rel_dir == '.' else f'{base}__{rel_dir.replace("/", "__")}'
    return re.sub(r'[<>:"|?*\\/]', '_', name) + '.txt'


def role_of(rel_dir):
    if rel_dir == '.':
        return ''
    return ROLE_OF.get(posixpath.basename(rel_dir).lower(), '')


def dir_label(d):
    return '(root)' if d == '.' else d


# ------------------------------------------------------------------ INDEX upsert
BLOCK_RX = re.compile(r'<!-- MERGE:BEGIN (.*?) -->\n(.*?)<!-- MERGE:END -->', re.S)
ATTR_RX = re.compile(r'(\w+)="([^"]*)"')
LEGACY_ROOT_RX = re.compile(r'(?m)^root: (.+)$')
LEGACY_BASE_RX = re.compile(r'(?m)^# (.+?) — generated ')


def parse_index(text):
    """Existing INDEX.md -> dict {root: (attrs, body)}; keeps insertion order."""
    blocks = {}
    if not text.strip():
        return blocks
    matches = list(BLOCK_RX.finditer(text))
    if matches:
        for m in matches:
            attrs = dict(ATTR_RX.findall(m.group(1)))
            key = attrs.get('root') or '\x00blk%d' % len(blocks)
            blocks[key] = (attrs, m.group(2).rstrip('\n') + '\n')
    else:
        # legacy INDEX.md written by an older version (single run, no markers)
        m = LEGACY_ROOT_RX.search(text)
        b = LEGACY_BASE_RX.search(text)
        key = m.group(1).strip() if m else '\x00legacy'
        blocks[key] = ({'root': key if m else '',
                        'base': b.group(1).strip() if b else 'legacy',
                        'updated': 'legacy'},
                       text.rstrip('\n') + '\n')
    return blocks


def build_toc(blocks):
    L = ['<!-- MERGE:TOC -->', f'# Merged INDEX — {len(blocks)} project(s)', '']
    if blocks:
        L += ['| project | root | updated |', '|---|---|---|']
        for attrs, _body in blocks.values():
            L.append(f"| {attrs.get('base', '?')} | `{attrs.get('root') or '?'}` | "
                     f"{attrs.get('updated', '?')} |")
    L.append('<!-- /MERGE:TOC -->')
    return '\n'.join(L)


def upsert_index(index_path, root, base, now, body):
    """Insert/replace this run's section in INDEX.md.

    Same root  -> its old section is replaced in place (updated, no duplicate).
    New root   -> section appended at the end.
    Returns (was_update, number_of_tracked_projects).
    """
    old = read_text(index_path) if os.path.exists(index_path) else ''
    blocks = parse_index(old)
    is_update = root in blocks
    blocks[root] = ({'root': root, 'base': base, 'updated': now}, body)
    parts = [build_toc(blocks)]
    for attrs, b in blocks.values():
        marker = ' '.join(f'{k}="{v}"' for k, v in attrs.items())
        parts.append(f'<!-- MERGE:BEGIN {marker} -->\n{b}<!-- MERGE:END -->')
    with open(index_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n\n'.join(parts) + '\n')
    return is_update, len(blocks)


# ------------------------------------------------------------------ pack (stage 2)
AI_DIR_NAME = '.ai-context'

PROMPT_TEMPLATE = """You are working on the attached project bundle.
Task: <describe the task>

Rules:
1. Return ONLY files you changed or created, each in FULL, in this exact format:
=== FILE: relative/path/to/file.php ===
<entire file content>
=== END FILE ===
2. Never use placeholders like "rest of the code" or "...". Never truncate.
3. Keep paths exactly as in the bundle. Do not rename or move files unless asked.
4. To delete a file, write: === DELETE: path/to/file.php ===
5. Keep the existing code style and conventions of the project.
6. After all files, add a short summary of what changed and why.
7. If the answer is too long, stop at a file boundary and write CONTINUED.
"""

# never packed: env/secret/key files, cert/keystore, db dumps
FORBIDDEN_FILE_RX = re.compile(
    r'(^|/)(\.env|[^/]*\.pem|[^/]*\.key|[^/]*\.p12|[^/]*\.pfx|[^/]*\.crt|'
    r'[^/]*\.keystore|id_rsa[^/]*|id_dsa[^/]*|id_ecdsa[^/]*|id_ed25519[^/]*|'
    r'secrets[^/]*|credentials[^/]*|\.htpasswd|auth\.json|[^/]*\.sqlite|[^/]*\.db)$', re.I)
FORBIDDEN_DIRS = {'vendor', 'node_modules', 'storage', 'uploads'}


def sha1_8(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()[:8]


def strip_jsonc(text):
    """JSON with // and /* */ comments and trailing commas -> strict JSON."""
    out, i, n = [], 0, len(text)
    in_str = esc = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            i += 1
        elif c == '"':
            in_str = True
            out.append(c)
            i += 1
        elif c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
        elif c == '/' and i + 1 < n and text[i + 1] == '*':
            i += 2
            while i + 1 < n and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 2
        else:
            out.append(c)
            i += 1
    return re.sub(r',\s*([}\]])', r'\1', ''.join(out))


def make_draft(files):
    """Grouping draft, 3 layers, no hardcoding:
    1) every Modules/<X> subtree -> one group;  2) two-segment dirs (app/Core)
    -> one group;  3) tiny two-segment dirs fold into their parent group."""
    kinds, parent_of = {}, {}
    dirs_of, files_of = defaultdict(set), defaultdict(set)
    for f in files:
        parts = f['rel'].split('/')
        dirs = parts[:-1]
        low = [d.lower() for d in dirs]
        g = None
        if 'modules' in low:
            i = low.index('modules')
            if i + 1 <= len(dirs) - 1:
                g = 'mod-' + dirs[i + 1].lower()
                dirs_of[g].add('/'.join(dirs[:i + 2]))
                kinds.setdefault(g, 'mod')
        if g is None and len(dirs) >= 2:
            g = (dirs[0] + '-' + dirs[1]).lower()
            dirs_of[g].add('/'.join(dirs[:2]))
            kinds.setdefault(g, 'dir2')
            parent_of.setdefault(g, dirs[0].lower())
        if g is None and len(dirs) == 1:
            g = dirs[0].lower()
            dirs_of[g].add(dirs[0])
            kinds.setdefault(g, 'dir1')
        if g is None:
            g = '(root)'
            kinds.setdefault(g, 'root')
        files_of[g].add(f['rel'])
    # fold dir2 groups with <= 1 file into their parent dir1 group
    for g in [x for x, k in kinds.items() if k == 'dir2' and len(files_of[x]) <= 1]:
        p = parent_of.get(g)
        if p and kinds.get(p) == 'dir1':
            files_of[p] |= files_of[g]
            files_of[g] = set()
    groups = {}
    for g in sorted(list(dirs_of) + list(files_of), key=lambda x: (x == '(root)', x)):
        kind = kinds.get(g, 'dir2')
        if kind == 'dir2' and not files_of[g]:
            continue  # folded away
        paths = sorted(dirs_of.get(g, ())) + sorted(files_of.get(g, ()))
        if paths:
            groups[g] = {'paths': paths}
    return groups


def load_groups_config(cfg_path):
    try:
        data = json.loads(strip_jsonc(read_text(cfg_path)))
    except ValueError as e:
        sys.exit(f'groups.json parse error: {e}')
    groups = data.get('groups') if isinstance(data, dict) else None
    if not isinstance(groups, dict) or not groups:
        sys.exit('groups.json has no usable "groups" object')
    return groups


def save_draft(cfg_path, groups, root, now):
    os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
    doc = {'__readme': 'paths: file, dir, or * pattern (relative to project root). '
                       'This file is never rewritten automatically (--reinit regenerates).',
           'project': os.path.basename(root), 'generated': now, 'groups': groups}
    with open(cfg_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(doc, indent=2, ensure_ascii=False) + '\n')


def scan_pack_files(root, exts, skip, ai_dir, self_path):
    """Collect analyzable code files for packing; secrets/binary/too-big excluded."""
    files, big, blocked = [], [], []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns
                        if d.lower() not in skip and not d.startswith('.')
                        and os.path.abspath(os.path.join(dp, d)) != ai_dir)
        for fn in sorted(fns):
            full = os.path.join(dp, fn)
            if os.path.abspath(full) == self_path:
                continue
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            low = fn.lower()
            stem, ext = os.path.splitext(low)
            if ext not in exts or low.endswith(SKIP_SUFFIXES):
                continue
            if FORBIDDEN_FILE_RX.search(rel):
                blocked.append(rel)
                continue
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            if size > MAX_FILE_BYTES:
                big.append(rel)
                continue
            raw = read_text(full)
            if '\x00' in raw[:8192]:
                blocked.append(rel + ' (binary)')
                continue
            lang = LANG.get(ext, 'none')
            text = clean(raw, lang)
            syms, pyimps = extract(raw, text, lang)
            files.append({'rel': rel, 'lang': lang, 'path': full, 'raw': raw, 'text': text,
                          'lines': count_lines(raw), 'syms': syms, 'pyimps': pyimps,
                          'sha1': sha1_8(full)})
    return files, big, blocked


def build_file_deps(files):
    """File -> file dependency edges (same heuristics as build_deps, finer grain)."""
    fileset = {f['rel'] for f in files}
    class_files = defaultdict(set)
    for f in files:
        if f['lang'] == 'php':
            for cat, label in f['syms']:
                if cat == 'class':
                    class_files[label.split()[-1]].add(f['rel'])
    edges = defaultdict(set)
    for f in files:
        text = f['text']
        dsts = set()
        if f['lang'] == 'php':
            for name in php_refs(text):
                rs = class_files.get(name)
                if rs and len(rs) == 1:
                    dsts.add(next(iter(rs)))
            for m in PHP_REQ.finditer(text):
                spec = m.group(1)
                cands = [posixpath.normpath(posixpath.join(posixpath.dirname(f['rel']), spec.lstrip('/'))),
                         posixpath.normpath(spec.lstrip('/'))]
                for c in cands:
                    if c in fileset:
                        dsts.add(c)
                        break
        elif f['lang'] == 'js':
            for spec in JS_IMPORT.findall(text):
                r = resolve_js(spec, f['rel'], fileset)
                if r:
                    dsts.add(r)
        elif f['lang'] == 'py':
            for level, module, names in f['pyimps']:
                for r in resolve_py(level, module, names, f['rel'], fileset):
                    dsts.add(r)
        dsts.discard(f['rel'])
        if dsts:
            edges[f['rel']] = dsts
    return edges


def expand_group_paths(root, paths, all_rels):
    """Config entry -> set of file rel paths (file | dir | fnmatch pattern)."""
    out = set()
    for p in paths or []:
        p = str(p).strip().replace('\\', '/')
        if not p:
            continue
        full = os.path.join(root, p)
        if os.path.isdir(full):
            pref = p.rstrip('/') + '/'
            out.update(r for r in all_rels if r.startswith(pref))
        elif os.path.isfile(full):
            out.add(p)
        elif '*' in p or '?' in p:
            out.update(r for r in all_rels if fnmatch.fnmatch(r.lower(), p.lower()))
        elif p in all_rels:
            out.add(p)
    return out


def print_groups_table(groups, gmap, by_rel, edges):
    print(f'groups in config: {len(groups)}')
    for name in groups:
        rels = sorted(gmap.get(name) or set(), key=str.lower)
        if not rels:
            print(f'  {name:26s} (0 files)')
            continue
        lines = sum(by_rel[r]['lines'] for r in rels if r in by_rel)
        tok = sum(len(by_rel[r]['raw']) for r in rels if r in by_rel) // 4
        dep_n = ''
        if edges is not None:
            out = set()
            for r in rels:
                out |= edges.get(r, set())
            dep_n = f', deps->{len(out - set(rels))}'
        print(f'  {name:26s} {len(rels):3d} files, {lines:7,} lines, {fmt_tok(tok)}{dep_n}')


def print_unassigned(all_rels, gmap, cfg_path):
    covered = set()
    for s in gmap.values():
        covered |= s
    un = sorted(all_rels - covered, key=str.lower)
    if un:
        print(f'[!] {len(un)} file(s) belong to no group:')
        for r in un[:15]:
            print('      ' + r)
        if len(un) > 15:
            print(f'      ... +{len(un) - 15} more')
        print(f'    -> assign them in {cfg_path}')
    return un


def write_bundle(bpath, base, now, group_names, items, dep_rels, big):
    total_lines = sum(f['lines'] for f, _ in items)
    total_tok = sum(len(f['raw']) for f, _ in items) // 4
    L = []
    L.append(f'# BUNDLE: {", ".join(group_names)} | project: {base} | generated: {now}')
    L.append(f'# files: {len(items)} | lines: {total_lines:,} | {fmt_tok(total_tok)}'
             + (' | includes --deps additions' if dep_rels else ''))
    if dep_rels:
        L.append('# deps added: ' + ', '.join(sorted(dep_rels)))
    if big:
        more = f' +{len(big) - 10}' if len(big) > 10 else ''
        L.append('# too big, NOT included: ' + ', '.join(big[:10]) + more)
    L.append('#')
    L.append('# OUTPUT CONTRACT for the AI:')
    L.append('# return ONLY changed/created files, each FULL, as:')
    L.append('#   === FILE: relative/path ===  <entire file>  === END FILE ===')
    L.append('# no "..." or "rest of the code" placeholders; deletions: === DELETE: path ===')
    L.append('# keep paths exactly as below; end with a short summary;')
    L.append('# if the answer gets too long, stop at a file boundary and write CONTINUED')
    L.append('')
    L.append('FILES IN THIS BUNDLE:')
    for f, is_dep in items:
        L.append(f'  {f["rel"]}  {f["lines"]} lines  sha1:{f["sha1"]}' + ('  (dep)' if is_dep else ''))
    L.append('')
    for f, _ in items:
        L.append('=' * 70)
        L.append(f'=== FILE: {f["rel"]} ===')
        L.append(f['raw'].rstrip('\n'))
        L.append('=== END FILE ===')
        L.append('')
    with open(bpath, 'w', encoding='utf-8', newline='\n') as out:
        out.write('\n'.join(L) + '\n')


def write_manifest_and_bases(bases_dir, bundles_dir, stem, bpath, root, now,
                             group_names, dep_rels, items):
    """Keep the bundle version locally: manifest + base copies for the future
    apply step (diff + 3-way merge)."""
    bdir = os.path.join(bases_dir, stem)
    man = {'bundle': os.path.basename(bpath), 'created': now, 'root': root,
           'groups': group_names, 'deps': sorted(dep_rels), 'files': []}
    for f, _ in items:
        dst = os.path.join(bdir, f['rel'].replace('/', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(f['path'], dst)
        man['files'].append({'path': f['rel'], 'lines': f['lines'], 'sha1': f['sha1']})
    with open(os.path.join(bundles_dir, stem + '.manifest.json'), 'w',
              encoding='utf-8', newline='\n') as out:
        json.dump(man, out, indent=2, ensure_ascii=False)
        out.write('\n')
    return bdir


def pack_main(argv):
    ap = argparse.ArgumentParser(
        description='Pack selected groups/modules into upload-ready bundle files')
    ap.add_argument('folder', nargs='?', help='project folder (asked interactively if omitted)')
    ap.add_argument('-g', '--groups', default='', help='comma separated group names, or "all"')
    ap.add_argument('--deps', action='store_true', help='add direct dependencies of the selected groups')
    ap.add_argument('--one-file', action='store_true', help='put all selected groups into ONE bundle file')
    ap.add_argument('--list-groups', action='store_true',
                    help='show groups, sizes and unassigned files, then exit')
    ap.add_argument('--out', help='base dir (default: <project>/.ai-context)')
    ap.add_argument('--exts', default=DEFAULT_EXTS, help=f'extensions to pack (default: {DEFAULT_EXTS})')
    ap.add_argument('--ignore', default='', help='extra folder names to skip, comma separated')
    ap.add_argument('--use-draft', action='store_true', help='use the freshly generated draft as-is')
    ap.add_argument('--reinit', action='store_true',
                    help='regenerate groups.json draft (old file kept as .bak)')
    ap.add_argument('--gitignore', action='store_true', help='add .ai-context/ to .gitignore')
    ap.add_argument('--save-prompt', action='store_true',
                    help='write the full AI prompt template to .ai-context/prompt-template.md')
    args = ap.parse_args(argv)

    folder = args.folder if args.folder else input('Folder: ')
    root = os.path.abspath(os.path.normpath(folder.strip().strip('"').strip("'")))
    if not os.path.isdir(root):
        sys.exit(f'Not a directory: {root}')
    base = os.path.basename(root) or 'project'
    self_path = os.path.abspath(__file__)
    exts = {'.' + e.strip().lstrip('.').lower() for e in args.exts.split(',') if e.strip()}
    skip = ({d.lower() for d in SKIP_DIRS} | FORBIDDEN_DIRS
            | {x.strip().lower() for x in args.ignore.split(',') if x.strip()})
    ai_dir = os.path.abspath(args.out) if args.out else os.path.join(root, AI_DIR_NAME)
    bundles_dir = os.path.join(ai_dir, 'bundles')
    bases_dir = os.path.join(ai_dir, 'bases')
    cfg_path = os.path.join(ai_dir, 'groups.json')
    os.makedirs(ai_dir, exist_ok=True)

    files, big, blocked = scan_pack_files(root, exts, skip, ai_dir, self_path)
    if not files:
        sys.exit('No matching files found.')
    by_rel = {f['rel']: f for f in files}
    all_rels = set(by_rel)

    # ---- groups.json: create draft once, then never rewrite it
    fresh = args.reinit or not os.path.exists(cfg_path)
    if fresh:
        if os.path.exists(cfg_path):
            shutil.copyfile(cfg_path, cfg_path + '.bak')
            print('[i] old groups.json kept as groups.json.bak')
        groups = make_draft(files)
        save_draft(cfg_path, groups, root, datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        print(f'[✓] draft groups.json written: {len(groups)} group(s) -> {cfg_path}')
        if not args.use_draft:
            print('    edit it (rename groups, adjust paths/patterns), then re-run pack.')
    else:
        groups = load_groups_config(cfg_path)

    gmap = {name: expand_group_paths(root, (meta or {}).get('paths'), all_rels)
            for name, meta in groups.items()}

    # ---- extras: prompt template + gitignore hygiene
    if args.save_prompt:
        pp = os.path.join(ai_dir, 'prompt-template.md')
        if os.path.exists(pp):
            print(f'[i] prompt template already exists: {pp}')
        else:
            with open(pp, 'w', encoding='utf-8', newline='\n') as f:
                f.write(PROMPT_TEMPLATE)
            print(f'[✓] prompt template written -> {pp}')
    if not args.out:
        gi = os.path.join(root, '.gitignore')
        ignored = os.path.exists(gi) and AI_DIR_NAME in read_text(gi)
        if not ignored:
            if args.gitignore:
                with open(gi, 'a', encoding='utf-8') as f:
                    f.write('\n' + AI_DIR_NAME + '/\n')
                print(f'[✓] added "{AI_DIR_NAME}/" to .gitignore')
            else:
                print(f'[i] reminder: keep "{AI_DIR_NAME}/" out of git '
                      f'(add to .gitignore or re-run with --gitignore)')

    # ---- overview
    edges = build_file_deps(files) if (args.deps or args.list_groups) else None
    print_groups_table(groups, gmap, by_rel, edges)
    print_unassigned(all_rels, gmap, cfg_path)
    if blocked:
        more = f' +{len(blocked) - 8}' if len(blocked) > 8 else ''
        print('[i] excluded by safety list: ' + ', '.join(blocked[:8]) + more)

    want_bundles = bool(args.groups) and not args.list_groups
    if want_bundles and fresh and not args.use_draft:
        print('[!] groups.json was just created - review/edit it, then re-run '
              '(or add --use-draft to accept the draft).')
        want_bundles = False
    if not want_bundles:
        return 0

    # ---- select groups
    names = [n.strip() for n in args.groups.split(',') if n.strip()]
    low_map = {n.lower(): n for n in groups}
    if [n.lower() for n in names] == ['all']:
        sel_names = list(groups)
    else:
        sel_names = []
        for n in names:
            real = low_map.get(n.lower())
            if not real:
                sys.exit(f'unknown group: {n}\navailable: {", ".join(groups)}')
            if real not in sel_names:
                sel_names.append(real)

    def items_of(rels):
        return [(by_rel[r], False) for r in sorted(rels, key=str.lower) if r in by_rel]

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    os.makedirs(bundles_dir, exist_ok=True)
    os.makedirs(bases_dir, exist_ok=True)

    def slug(ss):
        return re.sub(r'[^A-Za-z0-9._-]+', '-', '+'.join(ss)).strip('-')[:48] or 'bundle'

    plans = []
    if args.one_file:
        rels = set()
        for n in sel_names:
            rels |= gmap.get(n) or set()
        if rels:
            plans.append((slug(sel_names), sel_names, rels))
    else:
        for n in sel_names:
            rels = gmap.get(n) or set()
            if rels:
                plans.append((slug([n]), [n], rels))
            else:
                print(f'[!] group "{n}" matched 0 files - skipped')
    if not plans:
        sys.exit('no files matched the selected group(s)')

    for gslug, gnames, rels in plans:
        items = items_of(rels)
        dep_rels = set()
        if args.deps:
            incl = {f['rel'] for f, _ in items}
            for f, _ in items:
                dep_rels |= edges.get(f['rel'], set())
            dep_rels -= incl
            items = items + [(by_rel[r], True) for r in sorted(dep_rels) if r in by_rel]
        stem = f'{base}-{gslug}-{stamp}'
        n = 1
        while os.path.exists(os.path.join(bundles_dir, stem + '.txt')):
            n += 1
            stem = f'{base}-{gslug}-{stamp}-{n}'
        bpath = os.path.join(bundles_dir, stem + '.txt')
        write_bundle(bpath, base, now, gnames, items, dep_rels, big)
        bdir = write_manifest_and_bases(bases_dir, bundles_dir, stem, bpath, root,
                                        now, gnames, dep_rels, items)
        tok = sum(len(f['raw']) for f, _ in items) // 4
        print(f'[✓] bundle: {bpath} ({len(items)} files, {fmt_tok(tok)})')
        print(f'    base copy + manifest: {bdir} | {stem}.manifest.json')

    covered = set()
    for n in sel_names:
        covered |= gmap.get(n) or set()
    un = sorted(all_rels - covered, key=str.lower)
    if un:
        print(f'[i] {len(un)} file(s) outside this bundle were not in any group '
              f'(see list above)')
    return 0


def merge_main(argv=None):
    ap = argparse.ArgumentParser(
        description='Merge source files per directory + compact INDEX.md (subcommands: merge [default] | pack)')
    ap.add_argument('folder', nargs='?', help='project folder (asked interactively if omitted)')
    ap.add_argument('--out', help='output folder (default: "merged" next to this script)')
    ap.add_argument('--exts', default=DEFAULT_EXTS, help=f'extensions to merge (default: {DEFAULT_EXTS})')
    ap.add_argument('--ignore', default='', help='extra folder names to skip, comma separated')
    ap.add_argument('--max-symbols', type=int, default=8, help='symbols shown per file in INDEX')
    ap.add_argument('--no-deps', action='store_true', help='skip folder dependency analysis')
    ap.add_argument('--sql', action='store_true', help='add a tables -> files section')
    ap.add_argument('--folders-only', action='store_true', help='INDEX without per-file lines')
    ap.add_argument('--clean', action='store_true',
                    help='delete ALL old .txt files in the output folder before writing '
                         '(INDEX.md is never deleted)')
    args = ap.parse_args(argv)

    folder = args.folder if args.folder else input('Folder: ')
    root = os.path.abspath(os.path.normpath(folder.strip().strip('"').strip("'")))
    if not os.path.isdir(root):
        sys.exit(f'Not a directory: {root}')

    self_path = os.path.abspath(__file__)
    exts = {'.' + e.strip().lstrip('.').lower() for e in args.exts.split(',') if e.strip()}
    skip = {d.lower() for d in SKIP_DIRS} | {x.strip().lower() for x in args.ignore.split(',') if x.strip()}
    out_dir = os.path.abspath(args.out) if args.out else os.path.join(os.path.dirname(self_path), 'merged')
    base = os.path.basename(root) or 'project'

    # ---- collect
    code, keys, manifests, sql_files, big = [], [], [], [], []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns
                        if d.lower() not in skip and not d.startswith('.')
                        and os.path.abspath(os.path.join(dp, d)) != out_dir)
        for fn in sorted(fns):
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            low = fn.lower()
            stem, ext = os.path.splitext(low)
            if rel.count('/') <= 2 and (low in KEY_NAMES or (stem in ('routes', 'router') and ext in exts)):
                keys.append(rel)
            if low in MANIFESTS:
                manifests.append(rel)
            if args.sql and ext == '.sql':
                sql_files.append(full)
            if ext in exts and not low.endswith(SKIP_SUFFIXES) and os.path.abspath(full) != self_path:
                try:
                    size = os.path.getsize(full)
                except OSError:
                    continue
                if size > MAX_FILE_BYTES:
                    big.append(rel)
                    continue
                code.append((full, rel))

    # ---- analyze
    files = []
    for full, rel in code:
        ext = os.path.splitext(rel)[1].lower()
        raw = read_text(full)
        lang = LANG.get(ext, 'none')
        text = clean(raw, lang)
        syms, pyimps = extract(raw, text, lang)
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(full)).strftime('%Y-%m-%d %H:%M:%S')
        except OSError:
            mtime = '?'
        files.append({'rel': rel, 'dir': posixpath.dirname(rel) or '.', 'lang': lang,
                      'raw': raw, 'text': text, 'lines': count_lines(raw), 'mtime': mtime,
                      'syms': syms, 'pyimps': pyimps})
    if not files:
        sys.exit('No matching files found.')

    by_dir = defaultdict(list)
    for f in files:
        by_dir[f['dir']].append(f)
    dirs = sorted(by_dir, key=lambda d: (d != '.', d.lower()))

    edges = {} if args.no_deps else build_deps(files)
    tables = scan_tables(files) if args.sql else {}
    schema_tables = set()
    for p in sql_files:
        schema_tables.update(t.lower() for t in SQL_CREATE.findall(read_text(p)))
    pkgs = read_manifests(root, manifests)

    # ---- write merged txt files (incremental: keep other merges, overwrite dupes)
    os.makedirs(out_dir, exist_ok=True)
    if args.clean:
        for name in os.listdir(out_dir):
            if name.endswith('.txt'):
                try:
                    os.remove(os.path.join(out_dir, name))
                except OSError:
                    pass

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    info = {}
    written, overwritten, stale = [], 0, []
    for d in dirs:
        group = sorted(by_dir[d], key=lambda f: f['rel'].lower())
        name = txt_name(base, d)
        parts = [f'# Generated: {now}\n# Project: {base} | Directory: {dir_label(d)} | Files: {len(group)}\n\n']
        for f in group:
            parts.append(f'{"=" * 70}\nFILE: {f["rel"]} | {f["lines"]} lines | modified {f["mtime"]}\n{"=" * 70}\n')
            parts.append(f['raw'])
            if not f['raw'].endswith('\n'):
                parts.append('\n')
            parts.append('\n\n')
        content = ''.join(parts)
        out_path = os.path.join(out_dir, name)
        if os.path.exists(out_path):
            overwritten += 1
        with open(out_path, 'w', encoding='utf-8', newline='\n') as out:
            out.write(content)
        written.append(name)
        info[d] = {'name': name, 'tokens': len(content) // 4, 'files': group,
                   'lines': sum(f['lines'] for f in group)}

    # drop stale .txt files of THIS project (folders renamed/deleted since last run);
    # files of other merged projects (different name prefix) are never touched
    safe_base = re.sub(r'[<>:"|?*\\/]', '_', base)
    for name in os.listdir(out_dir):
        if (name.endswith('.txt') and name not in written
                and (name == safe_base + '.txt' or name.startswith(safe_base + '__'))):
            try:
                os.remove(os.path.join(out_dir, name))
                stale.append(name)
            except OSError:
                pass

    # ---- write INDEX.md (upsert: update this project's section, keep the rest)
    total_files = len(files)
    total_lines = sum(i['lines'] for i in info.values())
    total_tokens = sum(i['tokens'] for i in info.values())
    folders_only = args.folders_only or total_files > AUTO_FOLDERS_ONLY_ABOVE

    L = []
    L.append(f'# {base} — generated {now}')
    L.append(f'root: {root}')
    L.append(f'files: {total_files} | lines: {total_lines:,} | {fmt_tok(total_tokens)} | folders: {len(dirs)}')
    if folders_only and not args.folders_only:
        L.append(f'(more than {AUTO_FOLDERS_ONLY_ABOVE} files: showing folder level only)')
    if big:
        L.append(f'skipped (>{MAX_FILE_BYTES // 1000} KB): ' + ', '.join(big[:10]) + (f' +{len(big) - 10}' if len(big) > 10 else ''))
    L.append('')

    if keys:
        keys_sorted = sorted(keys, key=lambda k: (k.count('/'), k.lower()))
        L.append('## Key files')
        L.append(', '.join(keys_sorted[:20]) + (f' +{len(keys_sorted) - 20}' if len(keys_sorted) > 20 else ''))
        L.append('')

    if pkgs:
        L.append('## Dependencies')
        for rel, names in pkgs:
            extra = len(names) - MAX_PKGS_SHOWN
            L.append(f'{rel}: ' + ', '.join(names[:MAX_PKGS_SHOWN]) + (f' +{extra}' if extra > 0 else ''))
        L.append('')

    L.append('## Folders')
    for d in dirs:
        i = info[d]
        role = role_of(d)
        L.append(f'{dir_label(d)}  {"[" + role + "] " if role else ""}{len(i["files"])} files, '
                 f'{i["lines"]:,} lines → {i["name"]} ({fmt_tok(i["tokens"])})')
        if edges.get(d):
            top = edges[d].most_common()
            shown = ', '.join(f'{dir_label(t)}({c})' for t, c in top[:MAX_DEPS_SHOWN])
            more = len(top) - MAX_DEPS_SHOWN
            L.append(f'  deps: {shown}' + (f' +{more} more' if more > 0 else ''))
        if not folders_only:
            group = i['files']
            if len(group) > MAX_FILES_PER_FOLDER:
                group = sorted(sorted(group, key=lambda f: -f['lines'])[:MAX_FILES_PER_FOLDER],
                               key=lambda f: f['rel'].lower())
            for f in group:
                L.append(f'  {posixpath.basename(f["rel"])} {f["lines"]} | {fmt_symbols(f["syms"], args.max_symbols)}')
            if len(i['files']) > len(group):
                L.append(f'  … +{len(i["files"]) - len(group)} more files (largest shown)')
    L.append('')

    if args.sql:
        L.append('## Tables → files')
        if tables:
            for t in sorted(tables):
                fl = sorted(tables[t])
                tag = ' [in schema]' if t in schema_tables else ''
                L.append(f'{t}{tag}: ' + ', '.join(fl[:MAX_TABLE_FILES]) +
                         (f' +{len(fl) - MAX_TABLE_FILES}' if len(fl) > MAX_TABLE_FILES else ''))
        else:
            L.append('no table references found')
        unused = sorted(schema_tables - set(tables))
        if unused:
            L.append('in schema but not referenced in code: ' + ', '.join(unused))
        L.append('')

    body = '\n'.join(L).rstrip() + '\n'
    updated, n_projects = upsert_index(os.path.join(out_dir, 'INDEX.md'), root, base, now, body)

    print(f'[✓] {len(dirs)} merged file(s) -> {out_dir} | '
          f'{overwritten} overwritten | {len(stale)} stale removed')
    if stale:
        more = f' +{len(stale) - 8}' if len(stale) > 8 else ''
        print('    stale: ' + ', '.join(stale[:8]) + more)
    print(f'    INDEX.md: section "{base}" {"updated" if updated else "added"} '
          f'| {n_projects} project(s) tracked')
    print(f'    {total_files} files | {total_lines:,} lines | {fmt_tok(total_tokens)}')


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == 'pack':
        sys.exit(pack_main(argv[1:]))
    if argv and argv[0] == 'merge':
        argv = argv[1:]
    merge_main(argv)


if __name__ == '__main__':
    main()

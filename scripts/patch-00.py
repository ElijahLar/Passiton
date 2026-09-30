#!/usr/bin/env python3
"""Kontrollera och applicera en vald Passiton-patch utan commit eller push."""

import argparse
from pathlib import Path
import shutil
import subprocess
import sys


def git(repo, *args):
    return subprocess.run(
        ['git', '-C', str(repo), *args],
        capture_output=True, text=True, encoding='utf-8', errors='replace',
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('patch', help='Unikt patchnummer eller filnamn i patches/, t.ex. 00a.')
    parser.add_argument('--check', action='store_true',
                        help='Kontrollera patchen utan att ändra några filer.')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    patch_dir = repo / 'patches'
    name = args.patch
    if Path(name).name != name or '/' in name or '\\' in name:
        parser.error('Ange ett patchnummer eller filnamn, inte en sökväg.')
    candidates = sorted(patch_dir.glob('*.patch'))
    matches = [p for p in candidates if p.name == name or p.stem == name
               or p.stem.split('-', 1)[0] == name]
    if len(matches) != 1:
        print('Patchnamnet måste matcha exakt en fil i patches/.', file=sys.stderr)
        print('Tillgängliga: ' + ', '.join(p.name for p in candidates), file=sys.stderr)
        return 1
    patch = matches[0].resolve()
    if patch.parent != patch_dir.resolve():
        print('Patchen måste ligga i patches/.', file=sys.stderr)
        return 1

    if not shutil.which('git'):
        print('Git måste vara installerat.', file=sys.stderr)
        return 1
    if not patch.is_file():
        print(f'Patchen saknas: {patch}', file=sys.stderr)
        return 1
    root = git(repo, 'rev-parse', '--show-toplevel')
    if root.returncode or Path(root.stdout.strip()).resolve() != repo:
        print('Scriptet ska ligga i scripts/ i Passiton-repots rot.', file=sys.stderr)
        return 1

    check = git(repo, 'apply', '--check', str(patch))
    if check.returncode:
        reverse = git(repo, 'apply', '--reverse', '--check', str(patch))
        if reverse.returncode == 0:
            print('Patchen är redan applicerad. Inga filer ändrades.')
        else:
            print('Patchen kan inte appliceras. Inga filer ändrades.', file=sys.stderr)
            print(check.stderr.strip(), file=sys.stderr)
        return 1
    if args.check:
        print('Kontrollen är klar: patchen kan appliceras. Inga filer ändrades.')
        return 0

    result = git(repo, 'apply', str(patch))
    if result.returncode:
        print('Git kunde inte applicera patchen.', file=sys.stderr)
        print(result.stderr.strip(), file=sys.stderr)
        return 1
    print('Patchen är applicerad. Granska ändringarna med git diff.')
    print('Ingen commit eller push har gjorts.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

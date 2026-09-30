#!/usr/bin/env python3
"""Kontrollera och applicera Passitons strukturpatch utan commit eller push."""

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
    parser.add_argument('--check', action='store_true',
                        help='Kontrollera patchen utan att ändra några filer.')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    patch = repo / 'patches' / '001-project-structure.patch'

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
            print('Strukturpatchen är redan applicerad. Inga filer ändrades.')
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
    print('Strukturpatchen är applicerad. Granska ändringarna med git diff.')
    print('Ingen commit eller push har gjorts.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

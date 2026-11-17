import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'https://raw.githubusercontent.com/ActiveLogin/ActiveLogin.Authentication/' +
  '611d3c11d5275c987328c31301c6c1d7d6a7b664/src/ActiveLogin.Authentication.BankId.Core/BankIdResources/';
const directory = new URL('./.bankid-test/', import.meta.url);
const checksums = {
  'FPTestcert5_20240610.p12': '0453c963ed432c1b9d6f96d6938684d47b79ffe94fa76fc8d94cc96ffa8840ac',
  'BankIdApiRootCertificate-Test.crt': '3df299e01f6df1fa0e2421b484b65a8846a9063f4d76d4e4ca151973e4fc1efa'
};
const checksum = (contents) => createHash('sha256').update(contents).digest('hex');

try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, expected] of Object.entries(checksums)) {
    const destination = new URL(name, directory);
    const existing = await readFile(destination).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing && checksum(existing) === expected) continue;

    const response = await fetch(source + name, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(name + ' download failed (HTTP ' + response.status + ').');
    const contents = Buffer.from(await response.arrayBuffer());
    if (checksum(contents) !== expected) throw new Error(name + ' checksum did not match.');
    await writeFile(destination, contents, { mode: 0o600 });
  }
  console.log('BankID test certificates are ready.');
} catch (error) {
  console.error(error.message, error.cause?.code ?? '');
  process.exitCode = 1;
}

import { promises as fs } from 'node:fs';

const SECRETS_DIR = process.env.SECRETS_DIR ?? './secrets';
const ENCODING: {encoding: 'utf8'} = {encoding: 'utf8'};

const _loadedSecrets = new Map<string, Promise<string>>();

async function _loadSecret(name: string): Promise<string> {
  try {
    const secret = await fs.readFile(`${SECRETS_DIR}/${name}`, ENCODING);
    return secret.trim();
  } catch (err) {
    console.error('Failed to read secret', name, err);
    throw new Error(`Failed to read secret ${name}`);
  }
}

export function getSecret(name: string): Promise<string> {
  let secret = _loadedSecrets.get(name);
  if (!secret) {
    secret = _loadSecret(name);
    _loadedSecrets.set(name, secret);
  }
  return secret;
}

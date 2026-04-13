import { defineArgs } from './config';

const result = Bun.spawnSync(
  ['bun', ...defineArgs, 'src/entrypoints/cli.tsx', ...process.argv.slice(2)],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

process.exit(result.exitCode);

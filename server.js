import 'dotenv/config';
import app from './src/app.js';
import { env, assertProdSecrets } from './src/config/env.js';

assertProdSecrets();

app.listen(env.port, () => {
  console.log(`Skill99 CRM API running on http://localhost:${env.port}`);
});

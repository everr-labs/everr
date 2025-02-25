import baseConfig, { restrictEnvAccess } from '@citric/eslint-config/base';
import reactConfig from '@citric/eslint-config/react';

/** @type {import('typescript-eslint').Config} */
export default [...baseConfig, ...reactConfig, ...restrictEnvAccess];

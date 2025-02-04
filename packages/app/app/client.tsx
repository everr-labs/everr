// app/client.tsx
/// <reference types="vinxi/types/client" />
import { StrictMode } from 'react';
import { StartClient } from '@tanstack/start';
import { hydrateRoot } from 'react-dom/client';

import { createRouter } from './router';

const router = createRouter();

hydrateRoot(
	document,
	<StrictMode>
		<StartClient router={router} />
	</StrictMode>,
);

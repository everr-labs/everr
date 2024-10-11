import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import '@citric/tailwind-config/styles';

import { RouterProvider } from '@tanstack/react-router';

import { createRouter } from './router';

const rootElement = document.getElementById('app');

const router = createRouter();

if (rootElement && !rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>,
	);
}

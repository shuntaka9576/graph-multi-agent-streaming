import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { routeTree } from './routes/__root';

// API Gateway stage prefix detection (e.g., /prod/, /dev/)
const getBasePath = () => {
  const path = window.location.pathname;
  const match = path.match(/^\/[^/]+\//);
  return match ? match[0].slice(0, -1) : '';
};

const router = createRouter({
  routeTree,
  basepath: getBasePath(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}

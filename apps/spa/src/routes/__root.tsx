import { Outlet, createRootRoute, createRoute } from '@tanstack/react-router';

import { Chat } from '../components/Chat';

const rootRoute = createRootRoute({
  component: () => (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Chat,
});

export const routeTree = rootRoute.addChildren([indexRoute]);

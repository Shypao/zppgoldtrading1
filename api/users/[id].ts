// Vercel needs this explicit nested route for PATCH and DELETE requests to
// /api/users/<account-id>. The shared handler performs the authorization.
export { default } from '../../src/server.js';

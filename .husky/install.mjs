// Installs git hooks for development installs. Skips quietly when husky is
// absent, e.g. `npm ci --omit=dev`, so production installs don't fail.
try {
  const { default: husky } = await import('husky');
  const message = husky();
  if (message) console.warn(message);
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

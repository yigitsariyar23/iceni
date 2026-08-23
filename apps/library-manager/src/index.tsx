// Entry point. esbuild wraps this in an IIFE and appends the `render` binding
// that spicetify's route chunk re-exports as the module default -- see
// build.mjs. Nothing here may be a top-level ES export.
import { App } from './ui/App';

export default function LibraryManager() {
  return <App />;
}

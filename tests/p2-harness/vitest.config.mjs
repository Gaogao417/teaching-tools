import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
export default {root,cacheDir:resolve(root,'../../web/frontend/node_modules/.vite/p2-harness'),esbuild:{jsx:'automatic'},resolve:{alias:{zod:resolve(root,'../../web/backend/node_modules/zod'),react:resolve(root,'../../web/frontend/node_modules/react'),'react-dom':resolve(root,'../../web/frontend/node_modules/react-dom')}},test:{environment:'jsdom',include:['handshake.test.tsx'],maxWorkers:1}};

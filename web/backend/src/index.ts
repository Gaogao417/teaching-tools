import { createApp } from "./app";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const app = createApp();

app.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port}`);
});

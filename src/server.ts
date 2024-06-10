import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { redisInstance } from "./PubSubManager";

const wss = new WebSocketServer({ port: 3001 });

// WebSocket connection handler
wss.on("connection", async (ws: WebSocket, req: Request) => {
  const params = new URLSearchParams(req.url.split("?")[1]);
  const serverId = params.get("serverId");
  if (!serverId) {
    ws.send(JSON.stringify({ message: "Please add serverId to the connection url" }));
    ws.close();
    return;
  }

  const id = uuidv4();
  redisInstance.setWebSockClientMap(id, ws)
  await redisInstance.subscribeToChannel(serverId, id);
  const serverInfo = await redisInstance.getWebSocketServer(serverId);
  if(!serverInfo){
    ws.send(JSON.stringify({ message: 'Server not found.'}))
  }

  ws.on("message", async (message: string) => {
    try {
      const data = JSON.parse(message);
      const serverMsg = data.message;
      await redisInstance.publishToChannel(serverId, id, serverMsg);
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  });

  ws.on("close", async () => {
    await redisInstance.unSubscribeFromChannel(serverId, id)
  });

  ws.send(JSON.stringify({ message: `Welcome! to ${serverInfo?.name}`, id }));
});

console.log("Server running on port 3001");

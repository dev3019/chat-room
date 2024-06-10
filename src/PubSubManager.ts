require("dotenv").config({ path: ".env" });
import { RedisClientType, createClient } from "redis";
import WebSocket from "ws";

const { RED_HOST, RED_PORT } = process.env;
// Interface for WebSocket server information
interface WebSocketServerInfo {
  id: string;
  name: string;
  capacity: number;
  currentLoad: number;
  country: string;
  clients: Set<string>;
}
class PubSubManager {
  private static instance: PubSubManager;
  private webSocketClientMap: Map<string, WebSocket> = new Map();
  private redisClient: RedisClientType;
  private subClient: RedisClientType;
  private subscribedChannels: Set<string> = new Set(); // Track subscribed channels

  private constructor() {
    this.redisClient = createClient({
      socket: {
        host: RED_HOST,
        port: RED_PORT ? parseInt(RED_PORT, 10) : undefined,
      },
    });
    this.redisClient.connect().catch(console.error);

    this.subClient = this.redisClient.duplicate();
    this.subClient.connect().catch(console.error);
    // this.subClient.on('message', (channel, message) => {
    //   // this.handleMessage(channel, message);
    //   console.log('x', channel, message)
    //   const parsedMessage = JSON.parse(message);
    //   const { clientId, serverId, message: msg } = parsedMessage;
    //   this.broadcastMessageToClients(serverId, clientId, msg);
    // });
  }

  public static getInstance(){
    if(!PubSubManager.instance){
      PubSubManager.instance = new PubSubManager()
    }
    return PubSubManager.instance;
  }

  public async addWebSocketServer(serverInfo: WebSocketServerInfo){
    // await this.redisClient.hSet(
    //   'webSocketServers',
    //   serverInfo.id,
    //   JSON.stringify(serverInfo)
    // )
    const serverInfoToStore = {
      ...serverInfo,
      clients: Array.from(serverInfo.clients),
    };
    await this.redisClient.hSet(
      'webSocketServers',
      serverInfo.id,
      JSON.stringify(serverInfoToStore)
    );
    console.log(`Server info for: ${serverInfo.id} added to redis.`)
  }

  public async getWebSocketServer(serverId: string): Promise<WebSocketServerInfo | null> {
    const serverInfo = await this.redisClient.hGet("webSocketServers", serverId);
    // return serverInfo ? JSON.parse(serverInfo) : null;
    if (serverInfo) {
      const parsedServerInfo = JSON.parse(serverInfo);
      return {
        ...parsedServerInfo,
        clients: new Set(parsedServerInfo.clients),
      };
    }
    return null;
  }

  public async getAllWebSocketServers(): Promise<WebSocketServerInfo[]> {
    const servers = await this.redisClient.hGetAll("webSocketServers");
    // return Object.values(servers).map((server) => JSON.parse(server));
    return Object.values(servers).map((server) => {
      const parsedServer = JSON.parse(server);
      return {
        ...parsedServer,
        clients: new Set(parsedServer.clients),
      };
    });
  }

  public async removeWebSocketServer(serverId: string) {
    await this.redisClient.hDel("webSocketServers", serverId);
  }

  public setWebSockClientMap(clientId: string, ws: WebSocket){
    // PubSubManager.getWebSockClientMap().set(clientId, ws)
    this.webSocketClientMap.set(clientId, ws)
  }

  public async subscribeToChannel(
    serverId: string,
    clientId: string
  ): Promise<void> {
    try {
      const serverInfo = await this.getWebSocketServer(serverId);
      if (!serverInfo) {
        console.log(`Server not present with id: ${serverId}`);
        return;
      }
      const isSubscribed = this.subscribedChannels.has(serverId)
      if (isSubscribed) {
        console.log(
          `Server already subcribed to channel`
        );
      } else{
        console.log(`Subscribing to ${serverInfo?.name}`);
        this.subClient.subscribe(
          serverId,
          (message)=>{
            const parsedMessage = JSON.parse(message);
            const { clientId, serverId, message: msg } = parsedMessage;
            this.broadcastMessageToClients(serverId, clientId, msg);
          }
        )
        this.subscribedChannels.add(serverId);
      }
      serverInfo.currentLoad++;
      serverInfo.clients.add(clientId);
      console.log(serverInfo);
      await this.addWebSocketServer(serverInfo);
    } catch (error) {
      console.error(
        `Error subscribing client ${clientId} to server ${serverId}:`,
        error
      );
    }
  }

  public async publishToChannel(
    serverId: string,
    clientId: string,
    message: string
  ) {
    try {
      const serverInfo = await this.getWebSocketServer(serverId);
      if (!serverInfo) {
        console.log(`Server not found with id: ${serverId}`);
        return;
      }
      this.redisClient.publish(serverId,
        JSON.stringify({
          event: 'message',
          clientId,
          serverId,
          message
        })
      )
    } catch (error) {
      console.error(`Error occured while publishing message for ${clientId}: ${error}`)
    }
  }

  public async unSubscribeFromChannel(serverId: string, clientId: string){
    try {
      const serverInfo = await this.getWebSocketServer(serverId);
      if (!serverInfo) {
        console.log(`Server not present with id: ${serverId}`);
        return;
      }
      const isSubscribed = serverInfo.clients.has(clientId);
      if (!isSubscribed) {
        console.log(
          `Client: ${clientId} isn't subscribed to server: ${serverId}`
        );
        return;
      }
      this.webSocketClientMap.delete(clientId)
      serverInfo.currentLoad--;
      serverInfo.clients.delete(clientId);
      await this.addWebSocketServer(serverInfo);
      if (serverInfo.clients.size === 0) {
        console.log(`No more clients subscribed to ${serverId}, unsubscribing from channel.`);
        this.subClient.unsubscribe(serverId);
        this.subscribedChannels.delete(serverId);
      }
    } catch (error) {
      console.error(
        `Error unsubscribing client ${clientId} from server: ${serverId}`
      )
    }
  }

  private async broadcastMessageToClients(
    serverId: string,
    senderId: string,
    message: string
  ) {
    try {
      const serverInfo = await this.getWebSocketServer(serverId);
      if (!serverInfo) {
        console.log(`Server not found with id: ${serverId}`);
        return;
      }

      const clientsToRemove: string[] = [];

      serverInfo.clients.forEach(async(clientId) => {
        if (clientId !== senderId) {
          const clientWs = this.webSocketClientMap.get(clientId)
          if (!clientWs) {
            console.warn(
              `WebSocket connection for client: ${clientId} not found.`
            );
          } else if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                senderId,
                message,
              })
            );
          } else {
            console.warn(
              `WebSocket connection for client: ${clientId} not open, marking for removal.`
            );
            clientsToRemove.push(clientId);
          }
        }
      });

      clientsToRemove.forEach((clientId) => {
        this.webSocketClientMap.delete(clientId)
      });
    } catch (error) {
      console.log(`Error broadcasting message for client: ${senderId}`);
    }
  }
}

export const redisInstance = PubSubManager.getInstance()
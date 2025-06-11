import {
  createSigner,
  getEncryptionKeyFromHex,
  logAgentDetails,
  validateEnvironment,
} from "./client.js";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { ChatAgent } from "@virtuals-protocol/game";
import { GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";

/* Get the wallet key associated to the public key of
 * the agent and the encryption key for the local db
 * that stores your agent's messages */
const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV } =
  validateEnvironment([
    "WALLET_KEY",
    "ENCRYPTION_KEY",
    "XMTP_ENV",
    "GAME_AGENT_KEY",
  ]);


// Define the action space for the chat agent
const actionSpace = [
  new GameFunction({
    name: "fetch_bitcoin_prediction",
    description: "Fetches the latest bitcoin predictions",
    args: [
      {
        name: "amount",
        type: "number",
        description: "Number of predictions to fetch (1-10)",
        required: true,
        min: 1,
        max: 10
      }
    ] as const,
    executable: async (args, logger) => {
      try {
        const echoRes = await fetch(`https://echo.racfathers.io/echo?limit=${args.amount}`);
        if (!echoRes.ok) {
          throw new Error(`Failed to fetch echoes: ${echoRes.status} ${echoRes.statusText}`);
        }
        const echoes = await echoRes.json();
        logger("Fetched echoes: " + JSON.stringify(echoes));
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done,
          JSON.stringify(echoes)
        );
      } catch (e) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          `Failed to fetch echoes: ${e instanceof Error ? e.message : 'Unknown error'}`
        );
      }
    }
  }),
  new GameFunction({
    name: "get_racfathers_info",
    description: "Provides information about the Racfathers project",
    args: [] as const,
    executable: async (_, logger) => {
      try {
        const info = {
          name: "Racfathers",
          description: "A decentralized prediction platform for cryptocurrency markets",
          features: [
            "Bitcoin price predictions",
            "Rugpull Analysis",
            "Community-driven insights",
            "Decentralized architecture",
            "Real-time market analysis"
          ],
          website: "https://racfathers.io",
          social: {
            twitter: "@racfathers",
            discord: "discord.gg/racfathers"
          }
        };
        
        logger("Fetched Racfathers info: " + JSON.stringify(info));
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done,
          JSON.stringify(info)
        );
      } catch (e) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          `Failed to fetch Racfathers info: ${e instanceof Error ? e.message : 'Unknown error'}`
        );
      }
    }
  })
];

// Initialize the chat agent
if (!process.env.GAME_AGENT_KEY) {
  throw new Error('GAME_AGENT_KEY is required in environment variables');
}

const chatAgent = new ChatAgent(process.env.GAME_AGENT_KEY, "You are Echo Whisperer, an expert at analyzing bitcoin predictions and providing insights to users.");

/**
 * Main function to run the agent
 */
async function main() {
  /* Create the signer using viem and parse the encryption key for the local db */
  const signer = createSigner(WALLET_KEY);
  const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

  const client = await Client.create(signer, {
    dbEncryptionKey,
    env: XMTP_ENV as XmtpEnv,
  });

  void logAgentDetails(client);

  /* Sync the conversations from the network to update the local db */
  console.log("✓ Syncing conversations...");
  await client.conversations.sync();

  console.log("Waiting for messages...");
  /* Stream all messages from the network */
  const stream = await client.conversations.streamAllMessages();

  // Track active chats using a Map
  const activeChats = new Map();

  for await (const message of stream) {
    /* Ignore messages from the same agent or non-text messages */
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    console.log(
      `Received message: ${message.content as string} by ${message.senderInboxId}`,
    );

    /* Get the conversation from the local db */
    const conversation = await client.conversations.getConversationById(
      message.conversationId,
    );

    /* If the conversation is not found, skip the message */
    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    try {
      // Get or create chat for this user
      let chat = activeChats.get(message.senderInboxId);
      if (!chat) {
        chat = await chatAgent.createChat({
          partnerId: message.senderInboxId,
          partnerName: message.senderInboxId,
          actionSpace: actionSpace,
        });
        activeChats.set(message.senderInboxId, chat);
      }

      const userMessage = message.content as string;
      const response = await chat.next(userMessage);

      if (response.functionCall) {
        console.log(`Function call: ${response.functionCall.fn_name}`);
        // The function will be automatically executed by the agent
      }

      if (response.message) {
        await conversation.send(response.message);
      }

      if (response.isFinished) {
        // await conversation.send("Chat ended");
        console.log("Chat ended")
        activeChats.delete(message.senderInboxId);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      await conversation.send(
        "Sorry, I encountered an error processing your message.",
      );
    }

    console.log("Waiting for messages...");
  }
}

main().catch(console.error);

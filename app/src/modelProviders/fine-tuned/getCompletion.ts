/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  type ChatCompletion,
  type ChatCompletionCreateParams,
  type ChatCompletionMessage,
} from "openai/resources/chat";
import { v4 as uuidv4 } from "uuid";

import { prisma } from "~/server/db";
import { isComparisonModel } from "~/utils/baseModels";
import { countLlamaInputTokens, countLlamaTokens } from "~/utils/countTokens";
import { type CompletionResponse } from "../types";

export async function getExperimentsCompletion(
  input: ChatCompletionCreateParams,
  _onStream: ((partialOutput: ChatCompletion) => void) | null,
): Promise<CompletionResponse<ChatCompletion>> {
  try {
    const start = Date.now();
    const modelSlug = input.model.replace("openpipe:", "");
    const fineTune = await prisma.fineTune.findUnique({
      where: { slug: modelSlug },
    });
    if (!fineTune) {
      throw new Error("The model does not exist");
    }
    if (!fineTune.inferenceUrls.length) {
      throw new Error("The model is not set up for inference");
    }

    const completion = await getCompletion(
      input,
      fineTune.inferenceUrls,
      await getStringsToPrune(fineTune.id),
    );
    return {
      type: "success",
      value: completion,
      timeToComplete: Date.now() - start,
      statusCode: 200,
    };
  } catch (e) {
    return {
      type: "error",
      message: (e as Error).message,
      autoRetry: false,
    };
  }
}

export async function getCompletion(
  input: ChatCompletionCreateParams,
  inferenceURLs: string[],
  stringsToPrune: string[],
): Promise<ChatCompletion> {
  const { messages, ...rest } = input;
  const id = uuidv4();

  const templatedPrompt = templatePrompt(input, stringsToPrune);

  if (!templatedPrompt) {
    throw new Error("Failed to generate prompt");
  }

  const completionParams = {
    prompt: templatedPrompt,
    max_tokens: rest.max_tokens ?? 4096,
    temperature: rest.temperature ?? 0,
  };

  if (rest.n && rest.n > 1) {
    throw new Error("Multiple completions are not yet supported");
  }

  if (input.stream) {
    throw new Error("Streaming is not yet supported");
  }

  let resp;
  try {
    resp = await sendRequestWithBackup(inferenceURLs, completionParams);
  } catch (e) {
    throw new Error("Failed to query the model");
  }
  const respText = (await resp.json()) as { text: [string, ...string[]] };

  const finalCompletion = respText.text[0].split("### Response:")[1]?.trim();

  if (!finalCompletion) {
    throw new Error(`Unexpected response format from model: ${JSON.stringify(respText)}`);
  }

  const promptTokens = countLlamaInputTokens({ messages });
  const completionTokens = countLlamaTokens(finalCompletion);

  const completionMessage = parseCompletionMessage(finalCompletion);

  return {
    id,
    object: "chat.completion",
    created: Date.now(),
    model: input.model,
    choices: [
      {
        index: 0,
        message: completionMessage,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// If model is comparison model, this will return an empty array
export const getStringsToPrune = async (modelId: string) => {
  if (isComparisonModel(modelId)) return [];

  const pruningRules = await prisma.pruningRule.findMany({
    where: { fineTuneId: modelId },
    select: { textToMatch: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return pruningRules.map((rule) => rule.textToMatch);
};

export const pruneInputMessages = (messages: ChatCompletionMessage[], stringsToPrune: string[]) => {
  for (const stringToPrune of stringsToPrune) {
    for (const message of messages) {
      if (message.content) {
        message.content = message.content.replaceAll(stringToPrune, "");
      }
    }
  }
  messages = messages.filter((message) => message.content !== "" || message.function_call);
  return messages;
};

export const pruneInputMessagesStringified = (
  messages: ChatCompletionMessage[],
  stringsToPrune: string[],
) => JSON.stringify(pruneInputMessages(messages, stringsToPrune));

export const templatePrompt = (input: ChatCompletionCreateParams, stringsToPrune: string[]) => {
  const { messages } = input;

  const prunedInput = pruneInputMessagesStringified(messages, stringsToPrune);

  return `### Instruction:\n${prunedInput}\n### Response:`;
};

const sendRequestWithBackup = async (
  inferenceUrls: string[],
  completionParams: Record<string, unknown>,
) => {
  if (!inferenceUrls.length) throw new Error("No inference urls are available for this model");
  // choose random index from inferenceUrls
  const initialIndex = Math.floor(Math.random() * inferenceUrls.length);
  let resp;
  try {
    resp = await sendRequest(inferenceUrls[initialIndex] as string, completionParams);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // if the error is EHOSTUNREACH, try the next url in the list
    if (e.cause.code === "EHOSTUNREACH") {
      console.log("retrying with backup url");
      const backupIndex = initialIndex + 1 - inferenceUrls.length;
      resp = await sendRequest(inferenceUrls[backupIndex] as string, completionParams);
    } else {
      throw e;
    }
  }
  return resp;
};

const sendRequest = async (url: string, completionParams: Record<string, unknown>) => {
  return await fetch(url, {
    body: JSON.stringify(completionParams),
    method: "POST",
  });
};

export const FUNCTION_CALL_TAG = "<function>";
export const FUNCTION_ARGS_TAG = "<arguments>";

const parseCompletionMessage = (finalCompletion: string): ChatCompletionMessage => {
  const message: ChatCompletionMessage = {
    role: "assistant",
    content: null,
  };
  if (finalCompletion.startsWith(FUNCTION_CALL_TAG)) {
    const functionName = finalCompletion.split(FUNCTION_CALL_TAG)[1]?.split(FUNCTION_ARGS_TAG)[0];
    const functionArgs = finalCompletion.split(FUNCTION_ARGS_TAG)[1];
    message.function_call = { name: functionName as string, arguments: functionArgs ?? "" };
  } else {
    message.content = finalCompletion;
  }
  return message;
};

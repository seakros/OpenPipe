import { type Prisma } from "@prisma/client";
import { shuffle } from "lodash-es";
import { v4 as uuidv4 } from "uuid";
import { type RowToImport } from "~/components/datasets/parseRowsToImport";

import { prisma } from "~/server/db";

type CreateManyInput = Omit<Prisma.DatasetEntryCreateManyInput, "id"> & { id: string };

export const prepareDatasetEntriesForImport = async (
  datasetId: string,
  trainingRows: RowToImport[],
  updateCallback?: (progress: number) => Promise<void>,
  updateFrequency = 1000,
) => {
  const [dataset, existingTrainingCount, existingTestingCount] = await prisma.$transaction([
    prisma.dataset.findUnique({ where: { id: datasetId } }),
    prisma.datasetEntry.count({
      where: {
        datasetId,
        type: "TRAIN",
      },
    }),
    prisma.datasetEntry.count({
      where: {
        datasetId,
        type: "TEST",
      },
    }),
  ]);

  const trainingRatio = dataset?.trainingRatio ?? 0.8;

  const newTotalEntries = existingTrainingCount + existingTestingCount + trainingRows.length;
  const numTrainingToAdd = Math.floor(trainingRatio * newTotalEntries) - existingTrainingCount;
  const numTestingToAdd = trainingRows.length - numTrainingToAdd;
  const typesToAssign = shuffle([
    ...Array(numTrainingToAdd).fill("TRAIN"),
    ...Array(numTestingToAdd).fill("TEST"),
  ]);
  const datasetEntriesToCreate: CreateManyInput[] = [];
  const batchDate = Date.now();
  let i = 0;
  for (const row of trainingRows) {
    if (updateCallback && i % updateFrequency === 0) await updateCallback(i);
    const persistentId = uuidv4();
    datasetEntriesToCreate.push({
      id: uuidv4(),
      datasetId: datasetId,
      messages: row.input.messages as object[],
      function_call: row.input.function_call as object,
      functions: row.input.functions as object[],
      output: (row.output as unknown as Prisma.InputJsonValue) ?? {
        role: "assistant",
        content: "",
      },
      inputTokens: 0,
      outputTokens: 0,
      type: typesToAssign.pop() as "TRAIN" | "TEST",
      sortKey: `${batchDate}-${persistentId}`,
      persistentId,
    });
    i++;
  }

  return datasetEntriesToCreate;
};

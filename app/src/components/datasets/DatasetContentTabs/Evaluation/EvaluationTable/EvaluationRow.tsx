import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Text, VStack, HStack, GridItem, Box, Button, Icon } from "@chakra-ui/react";
import { type ChatCompletionMessage } from "openai/resources/chat";
import SyntaxHighlighter from "react-syntax-highlighter";
import { FiChevronUp, FiChevronDown } from "react-icons/fi";

import ColoredPercent from "~/components/ColoredPercent";
import { type RouterOutputs } from "~/utils/api";
import ModelHeader from "./ModelHeader";

export const TableHeader = ({
  showOriginalOutput,
  visibleModelIds,
}: {
  showOriginalOutput: boolean;
  visibleModelIds: string[];
}) => {
  const sharedProps = {
    position: "sticky",
    top: 0,
    bgColor: "white",
    borderBottomWidth: 1,
  };
  return (
    <>
      <GridItem sx={sharedProps} bgColor="white" zIndex={1} borderTopLeftRadius={4}>
        <Text fontWeight="bold" color="gray.500">
          Input
        </Text>
      </GridItem>
      {showOriginalOutput && (
        <GridItem sx={sharedProps} borderLeftWidth={1}>
          <Text fontWeight="bold" color="gray.500">
            Original Output
          </Text>
        </GridItem>
      )}
      {visibleModelIds.map((modelId, i) => (
        <GridItem
          key={modelId}
          sx={sharedProps}
          borderLeftWidth={1}
          borderTopRightRadius={i === visibleModelIds.length - 1 ? 4 : 0}
        >
          <ModelHeader modelId={modelId} />
        </GridItem>
      ))}
    </>
  );
};

type TestingEntry = RouterOutputs["datasetEntries"]["listTestingEntries"]["entries"][number];

const EvaluationRow = ({
  messages,
  output,
  fineTuneEntries,
  showOriginalOutput,
  visibleModelIds,
}: {
  messages: TestingEntry["messages"];
  output: TestingEntry["output"];
  fineTuneEntries: TestingEntry["fineTuneTestDatasetEntries"];
  showOriginalOutput: boolean;
  visibleModelIds: string[];
}) => {
  const orderedModelEntries = visibleModelIds.map(
    (modelId) =>
      fineTuneEntries.find((entry) => entry.modelId === modelId) || {
        modelId,
        output: null,
        errorMessage: null,
        score: null,
      },
  );

  const [maxOutputHeight, setMaxOutputHeight] = useState(0);
  const onHeightUpdated = useCallback(
    (height: number) => {
      if (height > maxOutputHeight) {
        setMaxOutputHeight(height);
      }
    },
    [maxOutputHeight, setMaxOutputHeight],
  );

  return (
    <>
      <FormattedInputGridItem messages={messages} maxOutputHeight={maxOutputHeight} />
      {showOriginalOutput && (
        <FormattedOutputGridItem output={output} onHeightUpdated={onHeightUpdated} />
      )}
      {orderedModelEntries.map((entry) => (
        <FormattedOutputGridItem
          key={entry.modelId}
          output={entry.output}
          errorMessage={entry.errorMessage}
          score={entry.score}
          onHeightUpdated={onHeightUpdated}
        />
      ))}
    </>
  );
};

const VERTICAL_PADDING = 32;
const FormattedInputGridItem = ({
  messages,
  maxOutputHeight,
}: {
  messages: TestingEntry["messages"];
  maxOutputHeight: number;
}) => {
  const inputRef = useRef<HTMLDivElement>(null);
  const [innerContentHeight, setInnerContentHeight] = useState(0);
  useLayoutEffect(() => {
    if (inputRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // Update the state with the new height
          setInnerContentHeight(entry.contentRect.height);
        }
      });

      // Start observing the element's size
      resizeObserver.observe(inputRef.current);

      return () => resizeObserver.disconnect();
    }
  }, []);

  const [isExpanded, setIsExpanded] = useState(false);
  const expandable = innerContentHeight > maxOutputHeight + VERTICAL_PADDING;

  return (
    <GridItem
      position="relative"
      borderTopWidth={1}
      h={isExpanded || !expandable ? innerContentHeight + 52 : maxOutputHeight + VERTICAL_PADDING}
      overflow="hidden"
      transition="height 0.5s ease-in-out"
    >
      <VStack ref={inputRef} alignItems="flex-start" spacing={8}>
        {(messages as unknown as ChatCompletionMessage[]).map((message, index) => (
          <VStack key={index} alignItems="flex-start" w="full">
            <Text fontWeight="bold" color="gray.500">
              {message.role}
            </Text>
            <FormattedMessage message={message} />
          </VStack>
        ))}
      </VStack>
      {expandable && (
        <VStack position="absolute" bottom={0} w="full" spacing={0}>
          {!isExpanded && (
            <Box
              w="full"
              h={16}
              background="linear-gradient(to bottom, transparent, white)"
              pointerEvents="none"
            />
          )}
          <HStack w="full" h={8} alignItems="flex-end" justifyContent="center" bgColor="white">
            <Button
              variant="link"
              colorScheme="gray"
              py={2}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <HStack spacing={0}>
                  <Text>Show less</Text>
                  <Icon as={FiChevronUp} mt={1} boxSize={5} />
                </HStack>
              ) : (
                <HStack spacing={0}>
                  <Text>Show more</Text>
                  <Icon as={FiChevronDown} mt={1} boxSize={5} />
                </HStack>
              )}
            </Button>
          </HStack>
        </VStack>
      )}
    </GridItem>
  );
};

type FormattedOutputProps = {
  output: TestingEntry["output"];
  score?: number | null;
  errorMessage?: string | null;
};

const FormattedOutputGridItem = ({
  output,
  score,
  errorMessage,
  onHeightUpdated,
}: FormattedOutputProps & { onHeightUpdated: (height: number) => void }) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ref.current) {
      const height = ref.current.getBoundingClientRect().height;
      if (height > 0) {
        onHeightUpdated(height);
      }
    }
  });
  return (
    <GridItem borderTopWidth={1} borderLeftWidth={1}>
      <Box ref={ref}>
        <FormattedOutput output={output} score={score} errorMessage={errorMessage} />
      </Box>
    </GridItem>
  );
};

const FormattedOutput = ({ output, score, errorMessage }: FormattedOutputProps) => {
  if (errorMessage) {
    return <Text color="red.500">{errorMessage}</Text>;
  }

  if (!output) return <Text color="gray.500">Pending</Text>;

  const message = output as unknown as ChatCompletionMessage;
  return <FormattedMessage message={message} score={score} />;
};

const FormattedMessage = ({
  message,
  score,
}: {
  message: ChatCompletionMessage;
  score?: number | null;
}) => {
  if (message.function_call) {
    const { name, arguments: args } = message.function_call;
    let parsedArgs = null;
    try {
      if (args) parsedArgs = JSON.parse(args);
    } catch (e) {
      // ignore
    }
    return (
      <VStack alignItems="flex-start" whiteSpace="pre-wrap">
        <HStack justifyContent="space-between" w="full">
          <Text fontWeight="bold">{name}</Text>
          {score !== null && score !== undefined && <ColoredPercent value={score} />}
        </HStack>
        {args &&
          (parsedArgs ? (
            <SyntaxHighlighter
              customStyle={{
                overflowX: "unset",
                width: "100%",
                flex: 1,
                backgroundColor: "#f0f0f0",
              }}
              language="json"
              lineProps={{
                style: { wordBreak: "break-all", whiteSpace: "pre-wrap" },
              }}
              wrapLines
            >
              {JSON.stringify(JSON.parse(args), null, 4)}
            </SyntaxHighlighter>
          ) : (
            <Text>{args}</Text>
          ))}
      </VStack>
    );
  }
  return <Text>{message.content}</Text>;
};

export default EvaluationRow;

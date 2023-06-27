import { Button } from "@chakra-ui/react";
import { BsPlus } from "react-icons/bs";
import { api } from "~/utils/api";
import { useExperiment, useHandledAsyncCallback } from "~/utils/hooks";
import { cellPadding, headerMinHeight } from "../constants";

export default function NewVariantButton() {
  const experiment = useExperiment();
  const mutation = api.promptVariants.create.useMutation();
  const utils = api.useContext();

  const [onClick] = useHandledAsyncCallback(async () => {
    if (!experiment.data) return;
    await mutation.mutateAsync({
      experimentId: experiment.data.id,
    });
    await utils.promptVariants.list.invalidate();
  }, [mutation]);

  return (
    <Button
      w="100%"
      alignItems="center"
      justifyContent="center"
      fontWeight="normal"
      bgColor="transparent"
      _hover={{ bgColor: "gray.100" }}
      px={cellPadding.x}
      onClick={onClick}
      height="unset"
      minH={headerMinHeight}
    >
      <BsPlus size={24} />
      Add Variant
    </Button>
  );
}
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@everr/ui/components/dialog";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Overlays/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename service</DialogTitle>
          <DialogDescription>
            The new name is used everywhere the service appears.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const WithFooterCloseButton: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export finished</DialogTitle>
          <DialogDescription>
            The export is ready. It stays available for seven days.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  ),
};

export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Confirm the change</DialogTitle>
          <DialogDescription>
            You must select an answer. There is no close button.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <DialogClose render={<Button />}>Confirm</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const ClosedUntilTriggered: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trigger opened this dialog</DialogTitle>
          <DialogDescription>
            The dialog starts closed, and the trigger button opens it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  ),
};

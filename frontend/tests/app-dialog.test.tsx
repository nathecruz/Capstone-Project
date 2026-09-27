import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { AppDialogProvider, useAppDialog } from '@/components/ui/app-dialog';

function DialogTrigger() {
  const showDialog = useAppDialog();
  return <Pressable accessibilityLabel="open dialog" onPress={() => showDialog('Delete habit?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }])}><Text>Open</Text></Pressable>;
}

describe('AppDialog', () => {
  it('renders a consistent confirmation dialog and closes after an action', async () => {
    const { getByLabelText, getByText, queryByText } = await render(<AppDialogProvider><DialogTrigger /></AppDialogProvider>);

    await fireEvent.press(getByLabelText('open dialog'));
    expect(getByText('Delete habit?')).toBeTruthy();
    expect(getByText('This cannot be undone.')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
    expect(getByText('Delete')).toBeTruthy();

    await fireEvent.press(getByText('Cancel'));
    expect(queryByText('Delete habit?')).toBeNull();
  });
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReminderTimeSheet } from '@/components/reminder-time-sheet';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const sheet = (initial = '07:10 AM') => {
  const onSave = jest.fn();
  const screen = render(<ReminderTimeSheet initial={initial} title="Change reminder time" taken={[]} onSave={onSave} onClose={jest.fn()} />);
  return { screen, onSave };
};

describe('ReminderTimeSheet', () => {
  it('saves any minute typed into the time', () => {
    const { screen, onSave } = sheet();
    fireEvent.changeText(screen.getByLabelText('Minutes, 00 to 59'), '12');
    fireEvent.press(screen.getByLabelText('Save reminder at 07:12 AM'));
    expect(onSave).toHaveBeenCalledWith('07:12 AM');
  });

  it('moves by single minutes across noon, and takes a typed hour', () => {
    const { screen, onSave } = sheet('11:58 AM');
    fireEvent.press(screen.getByLabelText('One minute later'));
    fireEvent.press(screen.getByLabelText('One minute later'));
    fireEvent.press(screen.getByLabelText('Save reminder at 12:00 PM'));
    expect(onSave).toHaveBeenLastCalledWith('12:00 PM');

    fireEvent.changeText(screen.getByLabelText('Hour, 1 to 12'), '9');
    fireEvent.press(screen.getByLabelText('One minute earlier'));
    fireEvent.press(screen.getByLabelText('Save reminder at 08:59 PM'));
    expect(onSave).toHaveBeenLastCalledWith('08:59 PM');
  });

  it('says what is wrong and does not save while the typed minutes are not a minute', () => {
    const { screen, onSave } = sheet();
    fireEvent.changeText(screen.getByLabelText('Minutes, 00 to 59'), '75');
    expect(screen.getByText('Type minutes from 00 to 59.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Save reminder at 07:10 AM'));
    expect(onSave).not.toHaveBeenCalled();

    // Typing on into the full field starts it over with the new digits.
    fireEvent.changeText(screen.getByLabelText('Minutes, 00 to 59'), '754');
    fireEvent.changeText(screen.getByLabelText('Minutes, 00 to 59'), '47');
    fireEvent.press(screen.getByLabelText('Save reminder at 07:47 AM'));
    expect(onSave).toHaveBeenCalledWith('07:47 AM');
  });
});

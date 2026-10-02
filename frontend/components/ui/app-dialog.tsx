import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useContext, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

export type AppDialogVariant = 'error' | 'success' | 'info';
export type AppDialogButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };

type AppDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  variant?: AppDialogVariant;
  onClose: () => void;
  buttons?: readonly AppDialogButton[];
};

const variantStyles = {
  error: {
    icon: 'alert-circle-outline' as const,
    color: '#d94f70',
    backgroundColor: '#fff0f4',
  },
  success: {
    icon: 'checkmark-circle-outline' as const,
    color: '#238a70',
    backgroundColor: '#e9faf4',
  },
  info: {
    icon: 'information-circle-outline' as const,
    color: '#4b55c8',
    backgroundColor: '#eef0ff',
  },
};

type DialogContent = Pick<AppDialogProps, 'title' | 'message' | 'variant' | 'buttons'>;
const buttonLabels = (list?: readonly AppDialogButton[]) => list?.map((button) => button.text).join('|') ?? '';

export function AppDialog({ visible, title, message, variant = 'info', onClose, buttons }: AppDialogProps) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  // Callers clear their dialog state on close while the fade-out is still running; keep
  // showing the last content until it is gone instead of an empty box.
  const [lastShown, setLastShown] = useState<DialogContent>({ title, message, variant, buttons });
  if (visible && (lastShown.title !== title || lastShown.message !== message || lastShown.variant !== variant || buttonLabels(lastShown.buttons) !== buttonLabels(buttons))) {
    setLastShown({ title, message, variant, buttons });
  }
  const content: DialogContent = visible ? { title, message, variant, buttons } : lastShown;
  const appearance = variantStyles[content.variant ?? 'info'];
  const dialogButtons = content.buttons?.length ? content.buttons : [{ text: 'OK', onPress: onClose }];
  const useStackedButtons = dialogButtons.length >= 3;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={[styles.iconWrap, { backgroundColor: themeColor(appearance.backgroundColor, 'backgroundColor') }]}>
            <Ionicons name={appearance.icon} size={30} color={appearance.color} />
          </View>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.message}>{content.message}</Text>
          <View style={[styles.buttonRow, useStackedButtons && styles.buttonColumn]}>
            {dialogButtons.map((button, index) => {
              const isDestructive = button.style === 'destructive';
              const isCancel = button.style === 'cancel';
              return <Pressable key={`${button.text}-${index}`} style={[styles.button, useStackedButtons && styles.stackedButton, isCancel && styles.cancelButton, isDestructive && styles.destructiveButton, !isCancel && !isDestructive && { backgroundColor: appearance.color }]} onPress={() => { onClose(); button.onPress?.(); }} accessibilityRole="button" accessibilityLabel={button.text}><Text style={[styles.buttonText, isCancel && styles.cancelButtonText]}>{button.text}</Text></Pressable>;
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

type AppDialogPayload = Omit<AppDialogProps, 'visible' | 'onClose'>;
const AppDialogContext = createContext<(title: string, message: string, buttons?: readonly AppDialogButton[], variant?: AppDialogVariant) => void>(() => undefined);

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<AppDialogPayload | null>(null);
  return <AppDialogContext.Provider value={(title, message, buttons, variant = 'info') => setDialog({ title, message, buttons, variant })}>{children}<AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} variant={dialog?.variant} buttons={dialog?.buttons} onClose={() => setDialog(null)} /></AppDialogContext.Provider>;
}

export function useAppDialog() {
  return useContext(AppDialogContext);
}

const themedStyles = createThemedStyles({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(20, 27, 45, 0.48)',
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    shadowColor: '#141b2d',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  iconWrap: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 31,
    marginBottom: 14,
  },
  title: {
    color: '#141b2d',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    color: '#657089',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  button: {
    flex: 1,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonRow: { width: '100%', flexDirection: 'row', gap: 10 },
  buttonColumn: { flexDirection: 'column' },
  stackedButton: { width: '100%', flex: 0 },
  cancelButton: { backgroundColor: '#F1F0F5' },
  destructiveButton: { backgroundColor: '#D94868' },
  cancelButtonText: { color: '#5F5A6D' },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});

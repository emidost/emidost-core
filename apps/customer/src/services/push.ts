import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as DeviceMgmt from '@emidost/device-kit';

/**
 * FCM push: data-only "kick" messages that pull the native command service
 * into its burst window (the lock itself is never delivered over push).
 * Every entry point is wrapped so push failures can NEVER break the lock
 * flow: no Play Services or a missing google-services.json only means the
 * kick channel is absent, and the 2 h idle poll still delivers commands.
 */

const KICK_TASK = 'BACKGROUND-NOTIFICATION-TASK';

/** Expo push projectId source (app.json extra.eas.projectId with fallback). */
export function pushProjectId(): string {
  return (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? '350e3d8b-b969-417a-a4df-b5f03a5794dd';
}

export function initPush(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // FCM messages are data-only kicks with no user-facing title: suppress
      // those. Local reminders set their own content at schedule time, so any
      // notification WITH a title still shows (and sounds) normally.
      const hasTitle = !!notification.request.content.title;
      return {
        shouldShowBanner: hasTitle,
        shouldShowList: hasTitle,
        shouldShowAlert: hasTitle,
        shouldPlaySound: hasTitle,
        shouldSetBadge: false,
      };
    },
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const settings = await Notifications.requestPermissionsAsync();
    return settings.granted;
  } catch {
    // Denied or unavailable: reminders degrade to their existing behavior.
    return false;
  }
}

export async function getPushToken(projectId: string): Promise<string | null> {
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    // No Play Services / no google-services.json: the lock flow continues
    // without the kick channel.
    return null;
  }
}

/** Background (headless) wake: a data-only kick pulls the native poll forward. */
export function registerKickTask(): void {
  TaskManager.defineTask(KICK_TASK, async () => {
    try {
      await DeviceMgmt.kickCommandService();
    } catch {
      // Headless wake reliability is a device item (checklist J5); never crash.
    }
  });
  try {
    void Notifications.registerTaskAsync(KICK_TASK);
  } catch {
    // Task registration can fail on devices without the FCM stack; the poll
    // cadence is the fallback.
  }
}

/** Foreground path: call onKick() whenever a data-only kick arrives. */
export function addKickListener(onKick: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener((request) => {
    const data = request?.request?.content?.data as Record<string, unknown> | undefined;
    if (data?.type === 'kick') onKick();
  });
  return () => sub.remove();
}

/** Token rotation: update the in-memory token the moment Expo reports a change. */
export function addPushTokenListener(onToken: (token: string) => void): () => void {
  const sub = Notifications.addPushTokenListener(({ data }) => {
    if (data) onToken(data);
  });
  return () => sub.remove();
}

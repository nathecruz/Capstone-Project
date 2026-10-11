/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  name: 'HabitWidget',
  // Shared with the app so the widget can read today's progress.
  entitlements: {
    'com.apple.security.application-groups': ['group.com.habitmind.app'],
  },
  frameworks: ['SwiftUI', 'WidgetKit'],
};

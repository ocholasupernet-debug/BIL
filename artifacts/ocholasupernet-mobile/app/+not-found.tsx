import React from 'react';
import { Stack } from 'expo-router';
import HomeScreen from './(tabs)/index';

/*
 * The Replit artifact proxy mounts this Expo app below /mobile/. On a native
 * build the app always starts at /(tabs), but the proxy may send /mobile/ to
 * the router as an unmatched web path. Render the same real app in that
 * case rather than exposing the scaffold's 404 screen in the preview.
 */
export default function ProxyEntry() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <HomeScreen />
    </>
  );
}

# Habi in 3D

Habi, the Habit Buddy, is a 3D hamster. This folder holds its model and the script that draws its
animations for the app. Nothing here is part of the app build: the app only shows the finished
pictures in `frontend/assets/buddy` (`components/buddy.tsx`), so no 3D engine runs on the phone.

- `buddy-scene.js` builds Habi from smooth shapes with [three.js](https://threejs.org): the body,
  head, face, ears, paws and feet, each on its own pivot. `pose(mood, t)` places them for a mood at a
  moment of its loop (`t` from 0 to 1), so every animation loops without a jump.
- `render.mjs` opens `index.html` in headless Chromium, draws every frame at 768 × 768 on a clear
  background and hands them to `encode.py`.
- `encode.py` scales the frames to 384 × 384 and saves:
  - `habi-<mood>.webp`, the animated loop of each mood (`happy`, `ecstatic`, `sleepy`, `hungry`,
    `sad`), and `habi-cheer.webp`, played once when Habi is tapped or gets something new;
  - `habi-<mood>-still.webp`, each loop's first frame, for small avatars and Reduce Motion.

The right paw holds Habi's item and the top of its head wears its hat. The app draws those (and its
accessory) over the picture, so the animations keep them nearly still: turning the head keeps the
top of it in place. If the model changes size or place, check `HEAD_TOP`, `PAW` and `CHEST_Y` in
`frontend/components/buddy.tsx`.

## Drawing the animations again

Needs Node.js 22, Python 3 with Pillow (`pip install pillow`) and Chromium for Playwright.

```sh
cd tools/buddy-3d
npm ci
npx playwright install chromium
npm run render          # every animation
node render.mjs happy   # only some of them
```

The files in `frontend/assets/buddy` are replaced. Rendering every animation takes a few minutes,
because the browser draws WebGL without a graphics card (SwiftShader).

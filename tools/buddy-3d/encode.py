# Turns rendered frames into Habi's animated WebP files and still images (render.mjs runs it).
# python3 -I encode.py <framesDir> <outDir> <size> <mood:frames:loopMs:still> ...
import os
import sys

from PIL import Image

frames_dir, out_dir, size, jobs = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4:]
os.makedirs(out_dir, exist_ok=True)
for job in jobs:
    mood, count, loop_ms, still = job.split(':')
    count, loop_ms = int(count), int(loop_ms)
    frames = [
        Image.open(os.path.join(frames_dir, f'{mood}-{index:03d}.png')).convert('RGBA').resize((size, size), Image.LANCZOS)
        for index in range(count)
    ]
    animation = os.path.join(out_dir, f'habi-{mood}.webp')
    # loop=0: plays forever. Lossy colour with a sharp alpha edge keeps each loop at a few hundred KB.
    frames[0].save(animation, save_all=True, append_images=frames[1:], duration=round(loop_ms / count), loop=0,
                   quality=80, alpha_quality=90, method=6, lossless=False, minimize_size=True)
    line = f'{mood}: {count} frames, {os.path.getsize(animation) // 1024} KB'
    if still == '1':
        # The loop's first frame, for small avatars and Reduce Motion.
        picture = os.path.join(out_dir, f'habi-{mood}-still.webp')
        frames[0].save(picture, quality=86, alpha_quality=95, method=6)
        line += f', still {os.path.getsize(picture) // 1024} KB'
    print(line)

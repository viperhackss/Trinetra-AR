# Trinetra AR

Trinetra AR is a browser simulator of an EagleEye-style helmet HUD: 3D compass ring, heading-up minimap, drone feed (colour by day, thermal at night), rearview mirror, five vision modes, radial menu, teammates through walls, team pings, alert queue, an exploded helmet view and a stereo view.

**Play:** https://viperhackss.github.io/Trinetra-AR/

Everything is simulated. The simulator has no weapons, no opponents and no targeting.

## Built for the Galaxy Z Fold 8

- **Cover screen** (5.5", 10:16) and **inner screen** (7.6", 4:3) layouts, portrait or landscape.
- **Flex mode:** half-fold the phone and the 3D view moves to the top half while a console-style deck (stick, buttons, vision modes, night, prone) fills the bottom half. Uses the Viewport Segments and Device Posture APIs; add `?flex=1` to the URL to force it.
- Full screen, screen wake lock, haptics for alerts and pings, optional **Motion look** (turn the phone to look around).
- Quality defaults to **High** on flagship GPUs (Snapdragon 8 Elite Gen 5 / Adreno 8xx). **Auto resolution** scales the 3D image to hold the frame rate while the HUD stays sharp at full resolution.
- Installable as an app (Add to Home screen) and cached for offline play.

## Rendering

three.js r160, HDR pipeline with MSAA and ACES tone mapping, plus:

- Preetham day sky with drifting clouds; image-based light made from the same sky; photographed night sky
- Sun-lit haze in the fog, soft shadow maps, contact shadows under containers and vehicles
- Bloom, god rays through trees, eye adaptation (and automatic gain in night vision), heat shimmer, visor smudges, slight chromatic aberration, colour grading
- Wind in trees and grass, grass that parts around your feet, rotor-wash dust
- Rigged, animated teammates (walk, run, kneel, prone); extruded SUV and pickup; black kites circling overhead
- Procedural sound: wind, footsteps on grass or dirt, drone motors, kite calls

## Controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Look | Mouse | Drag the view, or Motion look |
| Move / run | W A S D / Shift | Left stick / push it fully forward |
| Crouch / prone | C / Z | CROUCH / PRONE (Flex deck) |
| Vision and sensor menu | Hold Q | Hold MENU |
| Ping / ping wheel | E / hold E | PING / hold PING |
| Map ping | Hold M and click | Hold MAP |
| Rearview mirror | R | MIRROR |
| Acknowledge alert | Space | ACK |
| Night | N | Settings, or NIGHT on the Flex deck |
| Helmet view | H | Helmet |

## Repository layout

- `index.html`, `vendor/`, `assets/`, `sw.js`, `manifest.webmanifest`, icons: the static site served by GitHub Pages
- `source/`: the source modules (`src/js/*.js`, `src/00_head.html`) and `build.py`, which concatenates them into `index.html`

## Credits

- 3D engine: [three.js](https://threejs.org) r160, MIT licence (`vendor/THREE-LICENSE.txt`)
- Night sky: *Moonless Golf* by Poly Haven, CC0 (stored as an RGBE PNG pair)
- Grass textures: [OpenGameArt](https://opengameart.org/content/dark-grass), CC-BY 3.0, recoloured
- Teammate character: Mixamo character from the three.js examples (`Soldier.glb`), recoloured
- Day sky: Preetham analytic sky model (three.js `Sky`)

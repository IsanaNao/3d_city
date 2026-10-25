// Street traffic and pedestrians run here so dragging the camera does not
// compete with the simulation for the main thread. The main thread asks for a
// step each frame; while a step is in flight it simply skips asking, so slow
// frames never queue work up. Pose buffers are transferred, not copied, and
// handed back for reuse.
import { CAR_STRIDE, PERSON_STRIDE, createStreets, roadSegmentBuffer, stepStreets, writeCarPoses, writePersonPoses } from './poses.js';

let streets = null;

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`roads.json ${res.status}`);
      const roads = await res.json();
      streets = createStreets(roads);
      const segments = roadSegmentBuffer(roads);
      self.postMessage({
        type: 'ready',
        cars: streets.sim ? streets.sim.cars.length : 0,
        people: streets.crowd ? streets.crowd.people.length : 0,
        segments,
      }, [segments.buffer]);
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error) });
    }
    return;
  }
  if (msg.type === 'step' && streets) {
    if (msg.dt > 0) stepStreets(streets, msg.dt);
    const cars = streets.sim ? writeCarPoses(streets.sim, msg.cars?.length === streets.sim.cars.length * CAR_STRIDE ? msg.cars : new Float32Array(streets.sim.cars.length * CAR_STRIDE)) : new Float32Array(0);
    const people = streets.crowd ? writePersonPoses(streets.crowd, msg.people?.length === streets.crowd.people.length * PERSON_STRIDE ? msg.people : new Float32Array(streets.crowd.people.length * PERSON_STRIDE)) : new Float32Array(0);
    self.postMessage({ type: 'poses', cars, people }, [cars.buffer, people.buffer]);
  }
};

export class SoundEngine {
  private context?: AudioContext;
  private output?: GainNode;
  private drone?: OscillatorNode;
  private droneGain?: GainNode;
  private ambient = false;
  private muted = false;

  async unlock(): Promise<void> {
    if (!this.context) {
      if (typeof AudioContext === 'undefined') return;
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.gain.value = this.muted ? 0 : 0.42;
      this.output.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
    this.toggleAmbientHum(this.ambient);
  }

  private notes(frequencies: number[], step: number, length: number, volume: number): void {
    const context = this.context;
    const output = this.output;
    if (!context || !output || context.state !== 'running' || this.muted) return;

    frequencies.forEach((frequency, index) => {
      const start = context.currentTime + index * step;
      const oscillator = context.createOscillator();
      oscillator.type = index % 2 === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(volume, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
      oscillator.connect(envelope).connect(output);
      oscillator.start(start);
      oscillator.stop(start + length + 0.01);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
    });
  }

  playSelect(): void { this.notes([880, 1320, 1760], 0.027, 0.18, 0.09); }
  playBack(): void { this.notes([420, 280], 0.07, 0.20, 0.075); }
  playPinsRise(): void { this.notes([262, 330, 392, 523], 0.053, 0.25, 0.043); }
  playTrainChime(): void { this.notes([523, 659, 784], 0.11, 0.32, 0.038); }

  toggleAmbientHum(enabled: boolean): void {
    this.ambient = enabled;
    const context = this.context;
    if (!context || !this.output || context.state !== 'running') return;

    if (enabled && !this.drone) {
      this.drone = context.createOscillator();
      this.drone.type = 'triangle';
      this.drone.frequency.value = 73.4;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 160;
      this.droneGain = context.createGain();
      this.droneGain.gain.value = 0;
      this.drone.connect(filter).connect(this.droneGain).connect(this.output);
      this.drone.start();
    }
    this.droneGain?.gain.setTargetAtTime(enabled ? 0.018 : 0, context.currentTime, 0.16);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context) this.output?.gain.setTargetAtTime(muted ? 0 : 0.42, this.context.currentTime, 0.02);
  }

  destroy(): void {
    this.drone?.stop();
    this.drone = undefined;
    this.droneGain = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.output = undefined;
  }
}

export default SoundEngine;

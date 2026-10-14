/** Touch controls state, written by ui/TouchControls and read by the Player each frame. */
export const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

export const touch = {
  /** the overlay is mounted: the player moves without pointer lock */
  active: false,
  /** joystick, -1..1 (y up is negative) */
  moveX: 0, moveY: 0,
  jump: false, crouch: false,
  /** drag since the last frame, pixels */
  lookX: 0, lookY: 0,
}

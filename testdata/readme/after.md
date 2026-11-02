Images sometimes showed twice in the viewer. This change stops that.

For example, a dentist takes one X-ray and sees two copies of it. After this change the viewer shows one copy.

The cause is the **capture hook**, a function that runs each time a scanner sends an image. A rebuilt viewer list called the hook a second time for the same image. The hook now skips an image that it has already seen.

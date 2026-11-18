export const STUDIO_SPRINGS = {
  cardEntry: {
    type: "spring" as const,
    stiffness: 380,
    damping: 30,
    mass: 0.85,
  },
  cardReorder: {
    type: "spring" as const,
    stiffness: 450,
    damping: 35,
  },
  interactiveHover: {
    type: "spring" as const,
    stiffness: 500,
    damping: 25,
  },
  cardExit: {
    duration: 0.22,
    ease: [0.32, 0, 0.67, 0] as [number, number, number, number],
  },
};


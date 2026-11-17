// Calculateurs (exam simulators, "où gagner des points"), as a plugin.
import simulators from "../views/simulators.js";

export default {
  id: "calculateurs",
  title: "Calculateurs",
  description: "Bac, brevet, moyenne pondérée, et où une note de plus rapporterait le plus de points.",
  icon: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0",
  render: (data, rerender) => simulators.render(data, rerender),
};

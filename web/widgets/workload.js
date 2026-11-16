import { homeworkList } from "../lib.js";
import { workloadChart } from "../charts.js";

export default {
  type: "workload",
  title: "Charge de travail",
  description: "Graphique des devoirs par jour d'échéance : à faire et faits.",
  needs: ["homework"],
  defaults: { days: 14 },
  settings: [{ key: "days", label: "Nombre de jours", type: "number", min: 5, max: 35 }],

  render(data, settings) {
    return workloadChart(homeworkList(data), { days: settings.days });
  },
};

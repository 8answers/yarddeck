const statusSelect = document.querySelector(".tournament-status-select");
const tournamentCard = document.querySelector(".tournament-card");
const emptyTournaments = document.querySelector(".empty-tournaments");

const emptyStatuses = new Set(["Registration Close", "Live", "Completed"]);

function updateTournamentList() {
  const isEmpty = emptyStatuses.has(statusSelect.value);
  tournamentCard.hidden = isEmpty;
  emptyTournaments.hidden = !isEmpty;
}

statusSelect.addEventListener("change", updateTournamentList);
updateTournamentList();

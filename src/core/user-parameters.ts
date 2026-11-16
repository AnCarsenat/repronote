// Decoder for the `ParametresUtilisateur` response, adapted from pawnote
// (GPL-3.0-or-later, https://github.com/BlocksHub/Pawnote-LTS), which does not
// export it. Pronote only answers this request once per session, during the
// page's own startup, so we decode the response captured from the browser.
import {
  AccountKind,
  type SessionHandle,
  type Tab,
  type TabLocation,
  type UserAuthorizations,
  type UserParameters,
  type UserResource,
} from "@blockshub/pawnote-lts";

const decodeTab = (tab: any, session: SessionHandle): Tab => {
  const find = (id: string) => session.instance.periods.find((p) => p.id === id);
  return {
    defaultPeriod: tab.periodeParDefaut && find(tab.periodeParDefaut.V.N),
    location: tab.G,
    periods: tab.listePeriodes.V.map((p: any) => find(p.N)).filter(Boolean),
  } as Tab;
};

const decodeUserResource = (resource: any, session: SessionHandle): UserResource => {
  const tabs = new Map<TabLocation, Tab>();
  for (const tab of resource.listeOngletsPourPeriodes?.V ?? []) tabs.set(tab.G, decodeTab(tab, session));

  return {
    id: resource.N,
    kind: resource.G,
    name: resource.L,
    establishmentName: resource.Etablissement.V.L,
    className: resource.classeDEleve?.L,
    profilePicture: null, // TODO: build the photo attachment URL
    tabs,
    isDirector: resource.estDirecteur ?? false,
    isDelegate: resource.estDelegue ?? false,
    isMemberCA: resource.estMembreCA ?? false,
  } as UserResource;
};

const decodeUserAuthorizations = (data: any, tabs: any[]): UserAuthorizations => {
  const canReadDiscussions = data.AvecDiscussion ?? false;
  const canDiscuss = canReadDiscussions && !(data.discussionInterdit ?? false);

  const locations: TabLocation[] = [];
  const traverse = (obj: any): void => {
    if ("G" in obj) locations.push(obj.G);
    if ("Onglet" in obj) obj.Onglet.forEach(traverse);
  };
  (tabs ?? []).forEach(traverse);

  return {
    canReadDiscussions,
    canDiscuss,
    canDiscussWithStaff: canDiscuss && (data.AvecDiscussionPersonnels ?? false),
    canDiscussWithParents: canDiscuss && (data.AvecDiscussionParents ?? false),
    canDiscussWithStudents: canDiscuss && (data.AvecDiscussionEleves ?? false),
    canDiscussWithTeachers: canDiscuss && (data.AvecDiscussionProfesseurs ?? false),
    hasAdvancedDiscussionEditor: data.AvecDiscussionAvancee ?? false,
    maxAssignmentFileUploadSize: data.tailleMaxRenduTafEleve,
    tabs: locations,
  } as UserAuthorizations;
};

export const decodeUserParameters = (parameters: any, session: SessionHandle): UserParameters => {
  const resources: any[] =
    session.information.accountKind === AccountKind.PARENT
      ? parameters.ressource.listeRessources
      : [parameters.ressource];

  return {
    id: parameters.ressource.N,
    kind: parameters.ressource.G,
    name: parameters.ressource.L,
    resources: resources.map((r) => decodeUserResource(r, session)),
    authorizations: decodeUserAuthorizations(parameters.autorisations, parameters.listeOnglets),
  } as UserParameters;
};

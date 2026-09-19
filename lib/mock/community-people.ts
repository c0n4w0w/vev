import type { CommunityPersonSection } from "@/lib/types";

/**
 * Public organisational people shown by a community.
 *
 * These are not TING users and not memberships. They are organisation-published
 * contact rows: staff, central board members and local-group leaders. Some of
 * the same real-world people may also have TING accounts, but this fixture
 * never relies on that and never points at `profiles`.
 */
export interface CommunityPersonFixture {
  communityId: string;
  section: CommunityPersonSection;
  localGroupName?: string;
  name: string;
  role?: string;
  email?: string;
  description?: string;
  sortOrder: number;
}

export const communityPeople: CommunityPersonFixture[] = [
  // Tryggere Ruspolitikk — ansatte / sekretariat
  {
    communityId: "tryggere-ruspolitikk",
    section: "staff",
    name: "Ina Roll Spinnangr",
    role: "Daglig leder",
    email: "ina.roll@rusreform.no",
    sortOrder: 0,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "staff",
    name: "Dagfinn Hessen Paust",
    role: "Fagansvarlig",
    email: "dagfinn.hesse@rusreform.no",
    sortOrder: 1,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "staff",
    name: "Lars Bror Kristiansen",
    role: "Organisasjonssekretær",
    email: "bror@rusreform.no",
    sortOrder: 2,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "staff",
    name: "Emil Bjørnstad Belgau",
    role: "Kommunikasjonsrådgiver",
    email: "emilbelgau@rusreform.no",
    sortOrder: 3,
  },

  // Tryggere Ruspolitikk — sentralstyret
  {
    communityId: "tryggere-ruspolitikk",
    section: "board",
    name: "Jonas Ali Werket Ghanizadeh",
    role: "Styreleder",
    sortOrder: 0,
  },
  { communityId: "tryggere-ruspolitikk", section: "board", name: "Hallvar Hyldbakk", sortOrder: 1 },
  { communityId: "tryggere-ruspolitikk", section: "board", name: "Jørn Kløvvfjell Mjelva", sortOrder: 2 },
  { communityId: "tryggere-ruspolitikk", section: "board", name: "Armin Khoshneviszadeh", sortOrder: 3 },
  { communityId: "tryggere-ruspolitikk", section: "board", name: "Maren Vals Dekkerhus", sortOrder: 4 },
  { communityId: "tryggere-ruspolitikk", section: "board", name: "Gisle Vonen", sortOrder: 5 },
  { communityId: "tryggere-ruspolitikk", section: "board", name: "Line Rude Jacobsen", sortOrder: 6 },
  {
    communityId: "tryggere-ruspolitikk",
    section: "board",
    name: "Emil Bjørnstad Belgau",
    role: "Tryggere Ungdom",
    sortOrder: 7,
  },

  // Tryggere Ruspolitikk — lokallagsledere
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Oslo",
    name: "Line Rude Jacobsen",
    role: "Lokallagsleder",
    email: "line.jacobsen@rusreform.no",
    sortOrder: 0,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Akershus",
    name: "Christian T. Eikeland",
    role: "Lokallagsleder",
    email: "christian.eikeland@rusreform.no",
    sortOrder: 1,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Trøndelag",
    name: "Bent Heier Johansen",
    role: "Lokallagsleder",
    email: "bent.johansen@rusreform.no",
    sortOrder: 2,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Vestland",
    name: "Morten Revheim",
    role: "Lokallagsleder",
    email: "morten.revheim@rusreform.no",
    sortOrder: 3,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Rogaland",
    name: "Christian Øien",
    role: "Lokallagsleder",
    email: "christian.oie@rusreform.no",
    sortOrder: 4,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Agder",
    name: "Joachim Strandberg",
    role: "Lokallagsleder",
    email: "joachim.strandberg@rusreform.no",
    sortOrder: 5,
  },
  {
    communityId: "tryggere-ruspolitikk",
    section: "local_group_leader",
    localGroupName: "FTR Innlandet",
    name: "Eirik Olsen",
    role: "Lokallagsleder",
    email: "eirik.olsen@rusreform.no",
    sortOrder: 6,
  },

  // Tryggere Ungdom — ansatte
  {
    communityId: "tryggere-ungdom",
    section: "staff",
    name: "Ingrid E. Gøranson",
    role: "Generalsekretær (permisjon)",
    sortOrder: 0,
  },
  {
    communityId: "tryggere-ungdom",
    section: "staff",
    name: "Emma Mortensen",
    role: "Fungerende daglig leder",
    email: "emma.mortensen@rusreform.no",
    sortOrder: 1,
  },
  {
    communityId: "tryggere-ungdom",
    section: "staff",
    name: "Ole Thomas Lunde",
    role: "Politisk rådgiver",
    email: "ole@rusreform.no",
    sortOrder: 2,
  },
  {
    communityId: "tryggere-ungdom",
    section: "staff",
    name: "Thia Olivia Dahl",
    role: "Kommunikasjonsrådgiver",
    email: "thia@rusreform.no",
    sortOrder: 3,
  },
  {
    communityId: "tryggere-ungdom",
    section: "staff",
    name: "Sofia Litland Eckblad",
    role: "Organisasjonssekretær",
    email: "sofia.litland@rusreform.no",
    sortOrder: 4,
  },

  // Tryggere Ungdom — sentralstyret
  {
    communityId: "tryggere-ungdom",
    section: "board",
    name: "Emil Bjørnstad Belgau",
    role: "Styreleder",
    email: "emilbelgau@rusreform.no",
    sortOrder: 0,
  },
  { communityId: "tryggere-ungdom", section: "board", name: "Emil Mikalsen", role: "Nestleder", sortOrder: 1 },
  { communityId: "tryggere-ungdom", section: "board", name: "Turid Elise Hennig", role: "Styremedlem", sortOrder: 2 },
  { communityId: "tryggere-ungdom", section: "board", name: "Omar Nawaz", role: "Styremedlem", sortOrder: 3 },
  { communityId: "tryggere-ungdom", section: "board", name: "Iver Strømsvold", role: "Styremedlem", sortOrder: 4 },
];

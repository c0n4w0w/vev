alter type community_person_section add value if not exists 'crew';

comment on column community_people.section is
  'staff: ansatte/sekretariat. board: sentralstyret. local_group_leader: public contact for a local group. crew: public Under The Rug crew role.';

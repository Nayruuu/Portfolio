#!/usr/bin/env perl
#
# sort-usings.pl — outil transverse équipe Giraudy (source unique : vault org-memory).
#
# Trie chaque groupe de `using` consécutifs par longueur de ligne ascendante.
# Tiebreaker : ordre alphabétique.
# Préserve :
#   - les lignes vides (qui séparent les groupes System / externes / internes)
#   - le `global using` et `using static`
#   - les alias (`using X = Y;`)
#
# Ne recatégorise PAS : le découpage en groupes (lignes vides) reste à la
# charge du dev / de Claude — le script ne fait que le tri intra-bloc.
#
# Usage :
#   perl sort-usings.pl < file.cs > file.cs.tmp
#   cat file.cs | perl sort-usings.pl
#
# Câblage : appelé par le hook `.githooks/pre-commit` de chaque repo .NET, qui
# le référence via le chemin du vault (cf. skill giraudy-dotnet → tooling.md).
# Cross-platform : Perl est natif sur mac/Linux et bundlé par Git for Windows.

use strict;
use warnings;

my @output;
my @group;

sub flush_group {
    return unless @group;
    my @sorted = sort { length($a) <=> length($b) or $a cmp $b } @group;
    push @output, @sorted;
    @group = ();
}

while (my $line = <STDIN>) {
    if ($line =~ /^(global\s+)?using\s/) {
        push @group, $line;
    } else {
        flush_group();
        push @output, $line;
    }
}

flush_group();

print @output;

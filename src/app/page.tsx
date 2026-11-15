import { academicQuestions, methods } from "@/lib/content";
import Studio from "@/components/studio";
export default function Page() {
  const bank = academicQuestions();
  return (
    <Studio
      initialQuestion={bank.find((q) => q.id === 11723) || bank[0]}
      methods={methods()}
      total={bank.length}
    />
  );
}
